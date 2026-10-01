import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The runner reports what became of a document it claimed (see ../claim):
 * POST {platform, status: "processing" | "failed", error?}
 *   - "failed": the extraction failed, or someone discarded the document on the
 *     Development Portal. `error` is shown on the Requirements page, where "Send
 *     again" puts the document back to pending.
 *   - "processing": the runner is retrying a failed extraction.
 * A completed document is never changed (409), and neither is one that was sent
 * again in the meantime (pending), so a stale report can't undo a person's click.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "bad document id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!parsePlatform(body?.platform)) return badPlatform();
  const status = String(body?.status ?? "");
  if (status !== "processing" && status !== "failed") {
    return NextResponse.json({ error: "status must be 'processing' or 'failed'" }, { status: 400 });
  }
  const error = String(body?.error ?? "").trim().slice(0, 600);

  const supabase = serviceRoleClient();
  const from = status === "processing" ? ["failed", "processing"] : ["processing", "failed"];
  const { data, error: upErr } = await supabase
    .from("requirement_documents")
    .update({ status, error_message: status === "failed" ? error || "Extraction failed" : null })
    .eq("id", id)
    .in("status", from as ("failed" | "processing")[])
    .select("id, status");
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  if (data?.length) return NextResponse.json({ id, status });

  const { data: doc } = await supabase.from("requirement_documents").select("status").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "No such document (deleted in catalyst?)" }, { status: 404 });
  return NextResponse.json({ error: `The document is ${doc.status} in catalyst; not changed` }, { status: 409 });
}
