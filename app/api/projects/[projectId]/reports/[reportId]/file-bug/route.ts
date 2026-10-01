import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { canCreateBugs } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/types/database";

export const runtime = "nodejs";
export const maxDuration = 30;

type Severity = Database["public"]["Enums"]["bug_severity"];
const SEVERITIES: Severity[] = ["critical", "major", "minor", "trivial"];
type Finding = { title?: string; shot?: string | null; bug_id?: string; [k: string]: unknown };

/**
 * "File as bug" on an auto-test report (migration 0039): a person turns one finding into a
 * bug of this project, under the report's app version, after reviewing and editing it.
 *
 * POST {finding: <index>, title, description, steps_to_reproduce, severity}
 * - Session auth, QA/admin (canCreateBugs). The report is read, the bug inserted and the
 *   screenshot copied with the person's own session, so RLS applies to all of it.
 * - The finding's failure screenshot becomes a normal attachment of the bug.
 * - The finding is then marked filed in the report (service role: report rows have no user
 *   write policy). automation_key "autotest:<run>:<index>" makes a second click (or two
 *   people at once) find the same bug instead of filing a duplicate.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; reportId: string }> },
) {
  const { userId, level } = await requireProfile();
  if (!canCreateBugs(level)) return NextResponse.json({ error: "Only QA or an admin can file bugs" }, { status: 403 });
  const { projectId, reportId } = await params;
  const body = await req.json().catch(() => null);
  const index = Number(body?.finding);
  const title = String(body?.title ?? "").trim().slice(0, 300);
  const severity = (SEVERITIES.includes(body?.severity) ? body.severity : "minor") as Severity;
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ error: "finding is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "The bug needs a title" }, { status: 400 });

  const supabase = await createClient();
  const { data: row, error: rErr } = await supabase
    .from("automation_reports")
    .select("id, project_id, release_id, run_id, report, files")
    .eq("id", reportId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "No such report" }, { status: 404 });
  const report = (row.report ?? {}) as { findings?: Finding[] };
  const finding = report.findings?.[index];
  if (!finding) return NextResponse.json({ error: "No such finding" }, { status: 404 });

  const key = `autotest:${row.run_id}:${index}`;
  const { data: existing } = await supabase
    .from("bugs")
    .select("id")
    .eq("project_id", projectId)
    .eq("automation_key", key)
    .maybeSingle();
  let bugId = existing?.id ?? null;
  let created = false;
  if (!bugId) {
    const { data: bug, error: bErr } = await supabase
      .from("bugs")
      .insert({
        project_id: projectId,
        title,
        description: String(body?.description ?? "").slice(0, 8000) || null,
        steps_to_reproduce: String(body?.steps_to_reproduce ?? "").slice(0, 8000) || null,
        severity,
        release_id: row.release_id,
        source: "automation",
        automation_key: key,
        created_by: userId,
      })
      .select("id")
      .single();
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: bErr.code === "23505" ? 409 : 500 });
    bugId = bug.id;
    created = true;
  }

  // The failure screenshot, as a normal attachment of the bug.
  let attached = false;
  const files = (row.files ?? {}) as Record<string, string>;
  if (created && finding.shot && files[finding.shot]) {
    const { data: blob } = await supabase.storage.from("automation-reports").download(files[finding.shot]);
    if (blob) {
      const path = `${bugId}/${Date.now()}-${finding.shot}`;
      const { error: upErr } = await supabase.storage.from("attachments").upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (!upErr) {
        const { error: aErr } = await supabase.from("attachments").insert({
          bug_id: bugId,
          file_path: path,
          file_name: finding.shot,
          file_size_bytes: blob.size,
          uploaded_by: userId,
        });
        attached = !aErr;
      }
    }
  }

  const findings = [...(report.findings ?? [])];
  findings[index] = { ...finding, bug_id: bugId, filed_by: userId, filed_at: new Date().toISOString() };
  const { error: uErr } = await serviceRoleClient()
    .from("automation_reports")
    .update({ report: { ...report, findings } as Json })
    .eq("id", row.id);
  if (uErr) return NextResponse.json({ error: `Bug filed, but the report was not updated: ${uErr.message}`, bug_id: bugId }, { status: 500 });
  return NextResponse.json({ bug_id: bugId, created, attached });
}
