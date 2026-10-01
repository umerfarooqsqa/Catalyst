import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOWNLOAD_URL_SECONDS = 600;

/**
 * A runner takes the next requirements document that someone uploaded on a
 * project's Requirements page ("Send to Claude Code", status `pending`). Claude
 * Code on that machine extracts the requirements, a person reviews them there,
 * and the POST on the parent route (with `document_id`) completes this same row.
 *
 * POST {platform, runner, houses?: string[]}
 *   - Only documents of projects that have an app (house) on this platform, and
 *     with `houses`, only those apps (the ones the runner knows).
 *   - The claim is a conditional update (pending -> processing), so two runners
 *     never get the same document.
 * Returns { document: null } when nothing waits, otherwise { document: {id,
 * file_name, house, project, uploaded_by, created_at, download_url} }. The
 * download URL is a signed link to the private bucket, valid for 10 minutes.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const body = await req.json().catch(() => null);
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();
  const houses: string[] | null = Array.isArray(body?.houses) ? body.houses.map(String).slice(0, 500) : null;
  if (houses && houses.length === 0) return NextResponse.json({ document: null });

  const supabase = serviceRoleClient();
  // Same rule as resolveProject: Android projects carry house_slug, iOS ones house_group.
  const houseCol = platform === "android" ? "project.house_slug" : "project.house_group";
  let query = supabase
    .from("requirement_documents")
    .select(
      "id, file_name, file_path, created_at, project:projects!inner(id, name, house_slug, house_group, platform), uploader:profiles(full_name)",
    )
    .eq("status", "pending")
    .not(houseCol, "is", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (platform === "ios") query = query.eq("project.platform", "ios");
  if (houses) query = query.in(houseCol, houses);
  const { data: candidates, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const c of candidates ?? []) {
    const { data: took, error: upErr } = await supabase
      .from("requirement_documents")
      .update({ status: "processing", error_message: null })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!took?.length) continue; // another runner was quicker

    const { data: signed, error: signErr } = await supabase.storage
      .from("requirement-documents")
      .createSignedUrl(c.file_path, DOWNLOAD_URL_SECONDS);
    if (signErr || !signed) {
      await supabase
        .from("requirement_documents")
        .update({ status: "failed", error_message: `The uploaded file could not be found: ${signErr?.message ?? "no link"}` })
        .eq("id", c.id);
      continue;
    }
    return NextResponse.json({
      document: {
        id: c.id,
        file_name: c.file_name,
        house: platform === "android" ? c.project.house_slug : c.project.house_group,
        project: c.project.name,
        uploaded_by: c.uploader?.full_name ?? null,
        created_at: c.created_at,
        download_url: signed.signedUrl,
      },
    });
  }
  return NextResponse.json({ document: null });
}
