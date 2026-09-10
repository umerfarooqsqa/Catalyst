import type { BugCategory, Severity } from "@/lib/types/models";

/**
 * Auto-severity suggestion: keyword-match the bug title + description
 * against each category's `keyword_hints`. Always a *suggestion* — the UI
 * keeps it overridable and never silently forces it (per CLAUDE.md).
 *
 * Built-in hints layer on top of whatever the categories define, so the
 * feature works before an admin has curated hints.
 */
const BUILTIN_HINTS: Record<Severity, string[]> = {
  critical: [
    "crash",
    "crashes",
    "data loss",
    "data corruption",
    "security",
    "vulnerability",
    "exploit",
    "cannot login",
    "500",
    "outage",
    "payment failed",
    "unrecoverable",
  ],
  major: [
    "broken",
    "does not work",
    "doesn't work",
    "error",
    "fails",
    "incorrect",
    "wrong result",
    "blocked",
    "regression",
  ],
  minor: ["typo", "alignment", "spacing", "tooltip", "label", "cosmetic"],
  trivial: ["nitpick", "polish", "suggestion", "nice to have"],
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  trivial: 0,
};

export function suggestSeverity(
  text: string,
  categories: Pick<BugCategory, "keyword_hints" | "default_severity">[] = [],
): { severity: Severity; matched: string[] } | null {
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  let best: Severity | null = null;

  const consider = (severity: Severity, hints: string[] | null | undefined) => {
    for (const hint of hints ?? []) {
      const h = hint.trim().toLowerCase();
      if (h && haystack.includes(h)) {
        matched.push(hint);
        if (best === null || SEVERITY_RANK[severity] > SEVERITY_RANK[best]) {
          best = severity;
        }
      }
    }
  };

  for (const [severity, hints] of Object.entries(BUILTIN_HINTS) as [
    Severity,
    string[],
  ][]) {
    consider(severity, hints);
  }
  for (const cat of categories) {
    if (cat.default_severity) consider(cat.default_severity, cat.keyword_hints);
  }

  if (best === null) return null;
  return { severity: best, matched: [...new Set(matched)] };
}

/**
 * Best-guess category for a piece of text by counting `keyword_hints`
 * matches. Used by the new-bug flow and the requirements-ingestion
 * pipeline. Returns null when nothing matches.
 */
export function suggestCategory(
  text: string,
  categories: Pick<BugCategory, "id" | "name" | "keyword_hints">[],
): { id: string; name: string } | null {
  const haystack = text.toLowerCase();
  let best: { id: string; name: string; hits: number } | null = null;
  for (const cat of categories) {
    let hits = 0;
    for (const hint of cat.keyword_hints ?? []) {
      const h = hint.trim().toLowerCase();
      if (h && haystack.includes(h)) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { id: cat.id, name: cat.name, hits };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  trivial: "Trivial",
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  major: "bg-orange-100 text-orange-800 border-orange-200",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-200",
  trivial: "bg-slate-100 text-slate-700 border-slate-200",
};
