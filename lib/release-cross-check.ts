/**
 * REQ-6: cross-check a release's notes against the bugs logged in the portal.
 * Pure functions (no I/O) so the matching rules are easy to test.
 *
 * Findings:
 *  - claimed_fixed_still_open: notes claim it's fixed, the bug is still
 *    open / in progress / reopened.
 *  - claim_not_found: a claimed fix matches no bug in the portal.
 *  - undocumented_change: a bug is marked fixed / ready for retest but the
 *    notes never mention it.
 */
export type BugRef = { id: string; title: string; status: string };

export type Discrepancy =
  | { type: "claimed_fixed_still_open"; claim: string; bug_id: string; bug_title: string; status: string }
  | { type: "claim_not_found"; claim: string }
  | { type: "undocumented_change"; bug_id: string; bug_title: string; status: string };

const STILL_OPEN = new Set(["open", "in_progress", "reopened"]);
const FIXED = new Set(["fixed", "ready_for_retest"]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function matches(claim: string, title: string): boolean {
  const a = claim.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const b = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = tokens(claim);
  const tb = tokens(title);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.7;
}

/** Bullet/numbered lines from free release-notes text, markers stripped. */
export function extractClaims(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/)?.[1])
    .filter((l): l is string => !!l && l.length >= 8);
}

export type ClaimedBug = { claim: string; bug_id: string; bug_title: string; status: string };

/** REQ-14: the portal bugs the notes claim as fixed (same matching as crossCheck), one per bug. */
export function claimedBugs(claims: string[], bugs: BugRef[]): ClaimedBug[] {
  const out = new Map<string, ClaimedBug>();
  for (const claim of claims) {
    const hit = bugs.find((b) => matches(claim, b.title));
    if (hit && !out.has(hit.id)) out.set(hit.id, { claim, bug_id: hit.id, bug_title: hit.title, status: hit.status });
  }
  return [...out.values()];
}

export function crossCheck(claims: string[], bugs: BugRef[]): Discrepancy[] {
  const out: Discrepancy[] = [];
  const claimedBugIds = new Set<string>();

  for (const claim of claims) {
    const hit = bugs.find((b) => matches(claim, b.title));
    if (!hit) {
      out.push({ type: "claim_not_found", claim });
      continue;
    }
    claimedBugIds.add(hit.id);
    if (STILL_OPEN.has(hit.status)) {
      out.push({
        type: "claimed_fixed_still_open",
        claim,
        bug_id: hit.id,
        bug_title: hit.title,
        status: hit.status,
      });
    }
  }

  for (const b of bugs) {
    if (FIXED.has(b.status) && !claimedBugIds.has(b.id)) {
      out.push({ type: "undocumented_change", bug_id: b.id, bug_title: b.title, status: b.status });
    }
  }
  return out;
}
