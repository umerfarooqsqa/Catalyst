/**
 * REQ-14 gate: "the release-notes test points pass". Pure function, no I/O.
 *
 * The test points are the bugs the release notes claim as fixed
 * (`releases.claimed_bugs`, from the release-notes cross-check). Each is
 * covered by a generated test named `test_bug_<first 8 chars of the bug id>_*`.
 * The gate passes when every claimed bug's most recent result in this
 * release is a pass. A bug with no test in any run of the release blocks
 * the gate. So does a release whose notes were never cross-checked, or
 * whose claims matched no portal bug. A skipped test blocks it too (it
 * verified nothing), but is reported as "skipped", not as a failure.
 */
import type { ClaimedBug } from "@/lib/release-cross-check";

export type { ClaimedBug };
export type RunResults = { created_at: string; test_results: { key: string; status: string }[] | null };
export type BugVerdict = { bug_id: string; bug_title: string; result: "passed" | "failed" | "skipped" | "no_test"; test?: string };
export type Gate = { passed: boolean; reason: string; bugs: BugVerdict[] };

export function evaluateGate(claimed: ClaimedBug[], runs: RunResults[]): Gate {
  if (claimed.length === 0) {
    return {
      passed: false,
      reason: "no release-notes test points: the notes were not cross-checked yet, or no claim matched a portal bug",
      bugs: [],
    };
  }
  const newestFirst = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const bugs: BugVerdict[] = claimed.map((c) => {
    const prefix = `test_bug_${c.bug_id.slice(0, 8)}`;
    for (const run of newestFirst) {
      const hits = (run.test_results ?? []).filter((t) => t.key.includes(prefix));
      if (hits.length) {
        const bad = hits.find((t) => t.status !== "passed" && t.status !== "skipped");
        const skipped = hits.find((t) => t.status === "skipped");
        const result = bad ? "failed" : skipped ? "skipped" : "passed";
        return { bug_id: c.bug_id, bug_title: c.bug_title, result, test: (bad ?? skipped ?? hits[0]).key };
      }
    }
    return { bug_id: c.bug_id, bug_title: c.bug_title, result: "no_test" };
  });
  const failed = bugs.filter((b) => b.result === "failed").length;
  const skipped = bugs.filter((b) => b.result === "skipped").length;
  const untested = bugs.filter((b) => b.result === "no_test").length;
  if (failed || skipped || untested) {
    const parts = [
      failed && `${failed} failing`,
      skipped && `${skipped} skipped (not verified)`,
      untested && `${untested} with no test run in this release`,
    ].filter(Boolean);
    return { passed: false, reason: `release-notes test points not all passing: ${parts.join(", ")} (of ${bugs.length})`, bugs };
  }
  return { passed: true, reason: `all ${bugs.length} release-notes test point(s) passed`, bugs };
}
