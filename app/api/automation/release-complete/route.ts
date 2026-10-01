import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveRelease } from "@/lib/automation-release";
import { sendEmail } from "@/lib/email-server";
import type { ClaimedBug, Discrepancy } from "@/lib/release-cross-check";
import { evaluateGate, type RunResults } from "@/lib/regression-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REQ-13: mark a release's test cycle done and email the report. Marking
 * done never depends on the email succeeding -- an unconfigured mail
 * provider or an empty recipient list is reported back, not fatal.
 * Idempotent: completing an already-done release just re-sends nothing.
 * The REQ-14 gate does not block completion (that stays the tester's call),
 * but its verdict goes into the response and the email.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const { house, version } = body ?? {};
  if (!house || !version) {
    return NextResponse.json({ error: "house and version are required" }, { status: 400 });
  }

  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  const resolved = await resolveRelease(String(house), String(version), platform, false);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { project, release } = resolved;

  if (release.status === "done") {
    return NextResponse.json({ status: "done", already_done: true, email: { sent: false, reason: "already completed" } });
  }

  const supabase = serviceRoleClient();
  const { data: runs } = await supabase
    .from("automation_runs")
    .select("run_id, suite, passed, failed, broken, skipped, excel_report_path, created_at, test_results")
    .eq("release_id", release.id)
    .order("created_at");

  const totals = (runs ?? []).reduce(
    (t, r) => ({
      passed: t.passed + r.passed,
      failed: t.failed + r.failed,
      broken: t.broken + r.broken,
      skipped: t.skipped + r.skipped,
    }),
    { passed: 0, failed: 0, broken: 0, skipped: 0 },
  );
  const discrepancies = (release.discrepancies as Discrepancy[]) ?? [];
  const gate = evaluateGate((release.claimed_bugs as ClaimedBug[]) ?? [], (runs ?? []) as unknown as RunResults[]);

  const lines = [
    `Release test cycle complete: ${project.name} v${release.version}`,
    "",
    `Runs: ${runs?.length ?? 0}`,
    `Passed: ${totals.passed}   Failed: ${totals.failed}   Broken: ${totals.broken}   Skipped: ${totals.skipped}`,
    "",
    discrepancies.length === 0
      ? "Release-notes cross-check: no discrepancies recorded."
      : `Release-notes cross-check: ${discrepancies.length} discrepancy(ies):`,
    ...discrepancies.map((d) =>
      d.type === "claim_not_found"
        ? `  - claimed fix not found in the portal: ${d.claim}`
        : d.type === "claimed_fixed_still_open"
          ? `  - claimed fixed but still ${d.status}: ${d.bug_title}`
          : `  - ${d.status} but not in the release notes: ${d.bug_title}`,
    ),
    "",
    `Release-notes test points (REQ-14): ${gate.passed ? "PASSED" : "NOT PASSED"} -- ${gate.reason}`,
    ...gate.bugs.map((b) => `  - ${b.result}: ${b.bug_title}`),
    "",
    ...(runs ?? []).filter((r) => r.excel_report_path).map((r) => `Report (${r.suite}, run ${r.run_id}): ${r.excel_report_path}`),
  ];

  const { error } = await supabase
    .from("releases")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", release.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const email = await sendEmail(
    release.notify_emails,
    `[Catalyst] ${project.name} v${release.version} test cycle complete`,
    lines.join("\n"),
  );

  return NextResponse.json({ status: "done", totals, gate, email });
}
