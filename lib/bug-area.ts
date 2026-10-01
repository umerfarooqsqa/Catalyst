import type { BugCategory, RoleCategory } from "@/lib/types/models";

/**
 * Role categories (migration 0043): the work areas an admin manages on Admin -> Role
 * categories. Seeded with frontend (the app UI), backend (the trading server/API),
 * database (DBA) and devops (servers, deployments). A category's `key` is what
 * bugs.area, tasks.area, base_page.area, bug_categories.default_area and
 * profiles.skills hold. NULL on a bug or task = not set yet.
 *
 * The area is only ever *suggested* from the text (each category's keywords); QA
 * confirms or changes it. People with a category as a skill are offered for it, and
 * the database auto-assigns by it (the project's person, else the least busy one).
 */
export type BugArea = string;

/** Tailwind classes per colour name a category can have (spelled out so Tailwind keeps them). */
export const CATEGORY_COLORS: Record<string, string> = {
  sky: "bg-sky-50 text-sky-800 border-sky-200",
  violet: "bg-violet-50 text-violet-800 border-violet-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rose: "bg-rose-50 text-rose-800 border-rose-200",
  teal: "bg-teal-50 text-teal-800 border-teal-200",
  indigo: "bg-indigo-50 text-indigo-800 border-indigo-200",
  orange: "bg-orange-50 text-orange-800 border-orange-200",
  lime: "bg-lime-50 text-lime-800 border-lime-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
  cyan: "bg-cyan-50 text-cyan-800 border-cyan-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};
/** Solid bar colours for charts (project overview). */
export const CATEGORY_BARS: Record<string, string> = {
  sky: "bg-sky-500", violet: "bg-violet-500", amber: "bg-amber-500", emerald: "bg-emerald-500",
  rose: "bg-rose-500", teal: "bg-teal-500", indigo: "bg-indigo-500", orange: "bg-orange-500",
  lime: "bg-lime-500", fuchsia: "bg-fuchsia-500", cyan: "bg-cyan-500", slate: "bg-slate-400",
};
export const colorClass = (color: string | null | undefined) => CATEGORY_COLORS[color ?? ""] ?? CATEGORY_COLORS.slate;

export function categoryOf(cats: RoleCategory[], key: string | null | undefined): RoleCategory | undefined {
  return key ? cats.find((c) => c.key === key) : undefined;
}
/** Is `v` the key of an existing category? */
export function isArea(cats: RoleCategory[], v: unknown): v is string {
  return typeof v === "string" && cats.some((c) => c.key === v);
}
/** The badge / cell label of a category key (the key itself for one that was deleted meanwhile). */
export function shortLabel(cats: RoleCategory[], key: string | null | undefined): string {
  return categoryOf(cats, key)?.short_label ?? key ?? "";
}

/** A person's skills (profiles.skills), cleaned. */
export function skillsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match, so "ui" doesn't hit "build" and "rate" doesn't hit "accurate". */
function hits(haystack: string, hint: string): boolean {
  const h = hint.trim().toLowerCase();
  if (!h) return false;
  return new RegExp(`(^|[^a-z0-9])${escape(h)}($|[^a-z0-9])`).test(haystack);
}

/**
 * Best-guess category for a bug or task: each category's keywords (a phrase counts
 * 2, a word 1), plus each bug category's `keyword_hints` toward its `default_area`,
 * plus 2 for the chosen bug category's `default_area`. A tie returns null: no
 * guess beats a wrong one.
 */
export function suggestArea(
  text: string,
  roleCats: Pick<RoleCategory, "key" | "keywords">[],
  bugCats: Pick<BugCategory, "id" | "keyword_hints" | "default_area">[] = [],
  bugCategoryId?: string | null,
): { area: string; matched: string[] } | null {
  const haystack = text.toLowerCase();
  const score = new Map<string, number>(roleCats.map((c) => [c.key, 0]));
  const matched = new Map<string, string[]>(roleCats.map((c) => [c.key, []]));

  const consider = (area: string, list: string[] | null | undefined) => {
    const m = matched.get(area);
    if (!m) return; // a bug category pointing at a category that no longer exists
    for (const hint of list ?? []) {
      if (hits(haystack, hint) && !m.includes(hint)) {
        score.set(area, (score.get(area) ?? 0) + (hint.trim().includes(" ") ? 2 : 1));
        m.push(hint);
      }
    }
  };
  for (const c of roleCats) consider(c.key, c.keywords);
  for (const bc of bugCats) if (bc.default_area) consider(bc.default_area, bc.keyword_hints);
  const chosen = bugCategoryId ? bugCats.find((c) => c.id === bugCategoryId) : null;
  if (chosen?.default_area && score.has(chosen.default_area)) {
    score.set(chosen.default_area, (score.get(chosen.default_area) ?? 0) + 2);
  }

  const best = Math.max(0, ...score.values());
  const top = [...score.entries()].filter(([, v]) => v === best).map(([k]) => k);
  if (best === 0 || top.length !== 1) return null; // nothing, or a tie
  return { area: top[0], matched: matched.get(top[0]) ?? [] };
}

/**
 * The category an automation test points at, from its pytest node id or file: the
 * API suite (akdapiautomation/) is backend, the Appium UI suite (tests/) is
 * frontend. Generated tests can be either, so they get null unless the runner sends
 * it. Callers check the key still exists.
 */
export function areaFromTestKey(key: string | null | undefined): string | null {
  const k = (key ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (k.startsWith("akdapiautomation/")) return "backend";
  if (k.startsWith("tests/")) return "frontend";
  return null;
}

/** A project's people per category (project_area_developers) and its developer for bugs with none. */
export type AreaDevelopers = { none: string | null; areas: Record<string, string | null> };
export const NO_DEVELOPERS: AreaDevelopers = { none: null, areas: {} };

/**
 * The people to offer for a category: those with it as a skill, else (nobody has it
 * yet) every candidate, so a picker is never empty while skills are being set up.
 */
export function peopleForArea<T extends { skills?: unknown }>(
  people: T[],
  area: string | null,
): { list: T[]; matched: boolean } {
  if (!area) return { list: people, matched: false };
  const skilled = people.filter((p) => skillsOf(p.skills).includes(area));
  return skilled.length ? { list: skilled, matched: true } : { list: people, matched: false };
}

/** Who a bug of this category goes to: the project's person for it, else the project's developer. */
export function developerForArea(devs: AreaDevelopers, area: string | null | undefined): string | null {
  return (area ? devs.areas[area] : null) ?? devs.none;
}

/**
 * The update that moves a bug to `area`. With `reassign`, an open bug that is
 * unassigned or still with the person its old category routed it to moves to the
 * new category's person. A bug someone assigned by hand, or a lead handed to a
 * junior, keeps its assignee.
 */
export function areaPatch(
  bug: { area: string | null; assignee_id: string | null; status: string },
  area: string | null,
  devs: AreaDevelopers,
  reassign = true,
): { area: string | null; assignee_id?: string } {
  const patch: { area: string | null; assignee_id?: string } = { area };
  if (!reassign || bug.status === "closed") return patch;
  const next = developerForArea(devs, area);
  const routed = !bug.assignee_id || bug.assignee_id === developerForArea(devs, bug.area);
  if (next && routed && next !== bug.assignee_id) patch.assignee_id = next;
  return patch;
}
