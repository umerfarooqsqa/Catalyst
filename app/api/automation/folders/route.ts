import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The runner reports what is in each project's automation folder (`projects/
 * <platform>/<house>/`) so the portal can show the link on the project: the
 * folder path, how many tests were generated / approved / are awaiting review,
 * and when the project last ran. Idempotent per project (upsert).
 *
 * POST { platform, runner, folders: [{ house, folder, tests_total, tests_approved,
 *        tests_pending, last_run_at? }] }
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();
  const folders = Array.isArray(body?.folders) ? body.folders : null;
  if (!folders) return NextResponse.json({ error: "folders must be an array" }, { status: 400 });

  const supabase = serviceRoleClient();
  const synced: string[] = [];
  const skipped: { house: string; reason: string }[] = [];

  for (const f of folders) {
    const house = String(f?.house ?? "");
    const folder = String(f?.folder ?? "");
    if (!house || !folder) {
      skipped.push({ house, reason: "house and folder are required" });
      continue;
    }
    const found = await resolveProject(house, platform);
    if (!found.project) {
      skipped.push({ house, reason: found.error });
      continue;
    }
    const int = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
    const { error } = await supabase.from("project_automation").upsert(
      {
        project_id: found.project.id,
        runner_name: body?.runner ? String(body.runner) : null,
        folder,
        tests_total: int(f.tests_total),
        tests_approved: int(f.tests_approved),
        tests_pending: int(f.tests_pending),
        last_run_at: f.last_run_at ? String(f.last_run_at) : null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    synced.push(house);
  }
  return NextResponse.json({ platform, synced, skipped });
}
