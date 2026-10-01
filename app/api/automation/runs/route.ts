import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveRelease } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REQ-4/5: the automation console posts a finished run's summary here,
 * filed under the house + version it ran against (the release is created
 * on first contact). Idempotent per (release, run_id) -- a retried POST
 * updates the same row instead of double-counting.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const { house, version, run_id } = body ?? {};
  if (!house || !version || !run_id) {
    return NextResponse.json({ error: "house, version and run_id are required" }, { status: 400 });
  }

  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  const resolved = await resolveRelease(String(house), String(version), platform);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const supabase = serviceRoleClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .upsert(
      {
        release_id: resolved.release.id,
        run_id: String(run_id),
        suite: String(body.suite ?? "mixed"),
        passed: Number(body.passed ?? 0),
        failed: Number(body.failed ?? 0),
        broken: Number(body.broken ?? 0),
        skipped: Number(body.skipped ?? 0),
        excel_report_path: body.excel_report_path ?? null,
        started_at: body.started_at ?? null,
        finished_at: body.finished_at ?? null,
        // REQ-14: per-test outcomes, [{key, status}]; anything malformed is dropped.
        test_results: Array.isArray(body.tests)
          ? body.tests
              .filter((t: unknown) => t && typeof t === "object" && "key" in t && "status" in t)
              .map((t: { key: unknown; status: unknown }) => ({ key: String(t.key), status: String(t.status) }))
          : [],
      },
      { onConflict: "release_id,run_id" },
    )
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run: data.id, release_id: resolved.release.id, project: resolved.project.name, platform });
}
