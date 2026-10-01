import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";
import type { Json } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REPORT_BYTES = 4 * 1024 * 1024;

/**
 * An auto-test report from the aktrade runner (utils/autotest_report.py::send), migration 0039.
 * A person started the run with one click in the Development Portal; the runner tested the whole
 * app and posts what happened: tests, requirement coverage, past bugs re-checked on this app,
 * findings, the screen map and what it learned from.
 *
 * POST {house, platform, run_id, version?, runner?, status: complete|partial, started_at?,
 *       finished_at?, cost_usd?, summary, report}
 *   - Upserted on (project, run_id): sending the same run again replaces its report.
 *   - Linked to the version's release when that release exists (never creates one).
 *   - Returns {report_id, project_id}. Files follow through ./[id]/files.
 * Nothing is filed as a bug here: the report page's "File as bug" is a person's click.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const raw = await req.text();
  if (raw.length > MAX_REPORT_BYTES) return NextResponse.json({ error: "The report is larger than 4 MB" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  }
  const house = String(body.house ?? "").trim();
  const runId = String(body.run_id ?? "").trim().slice(0, 80);
  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  if (!house || !runId) return NextResponse.json({ error: "house and run_id are required" }, { status: 400 });
  if (typeof body.report !== "object" || body.report === null) {
    return NextResponse.json({ error: "report must be an object" }, { status: 400 });
  }
  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const project = found.project;
  const supabase = serviceRoleClient();

  const version = String(body.version ?? "").trim().slice(0, 40) || null;
  let releaseId: string | null = null;
  if (version) {
    const { data: rel } = await supabase
      .from("releases")
      .select("id")
      .eq("project_id", project.id)
      .eq("version", version)
      .maybeSingle();
    releaseId = rel?.id ?? null;
  }
  const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const { data, error } = await supabase
    .from("automation_reports")
    .upsert(
      {
        project_id: project.id,
        release_id: releaseId,
        version,
        run_id: runId,
        runner: String(body.runner ?? "").slice(0, 120) || null,
        platform,
        status: body.status === "partial" ? "partial" : "complete",
        started_at: date(body.started_at),
        finished_at: date(body.finished_at),
        cost_usd: typeof body.cost_usd === "number" ? body.cost_usd : null,
        summary: (body.summary ?? {}) as Json,
        report: body.report as Json,
      },
      { onConflict: "project_id,run_id" },
    )
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report_id: data.id, project_id: project.id });
}
