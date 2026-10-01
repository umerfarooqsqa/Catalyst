import type { BugCategory } from "@/lib/types/models";

/**
 * A bug's area (migrations 0041, 0042): frontend = the app UI (screens, layout,
 * navigation); backend = the trading server/API (wrong data, failed orders,
 * feed, login service); database = the data store (queries, missing or
 * duplicate records, deadlocks); devops = servers, deployments and
 * infrastructure (downtime, SSL, gateways). NULL on a bug = not set yet.
 *
 * Like severity, the area is only ever *suggested* from the bug's text; QA
 * confirms or changes it. People carry the same values as skills
 * (profiles.skills), so the right people are offered for an area.
 */
export type BugArea = "frontend" | "backend" | "database" | "devops";
export const AREAS: BugArea[] = ["frontend", "backend", "database", "devops"];
export const AREA_LABELS: Record<BugArea, string> = {
  frontend: "Frontend (app)",
  backend: "Backend (server/API)",
  database: "Database (DBA)",
  devops: "DevOps (servers, deploys)",
};
/** Short form for badges and table cells. */
export const AREA_SHORT: Record<BugArea, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  devops: "DevOps",
};
/** A person's skill, as shown next to their name. */
export const SKILL_LABELS: Record<BugArea, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "DBA",
  devops: "DevOps",
};
export const AREA_COLORS: Record<BugArea, string> = {
  frontend: "bg-sky-50 text-sky-800 border-sky-200",
  backend: "bg-violet-50 text-violet-800 border-violet-200",
  database: "bg-amber-50 text-amber-800 border-amber-200",
  devops: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function isBugArea(v: unknown): v is BugArea {
  return typeof v === "string" && (AREAS as string[]).includes(v);
}

/** A person's skills, cleaned (profiles.skills). */
export function skillsOf(v: unknown): BugArea[] {
  return Array.isArray(v) ? v.filter(isBugArea) : [];
}

const BUILTIN_HINTS: Record<BugArea, string[]> = {
  frontend: [
    "screen", "button", "layout", "alignment", "aligned", "overlap", "overlaps", "cut off",
    "truncated", "font", "colour", "color", "icon", "image", "scroll", "scrolling", "keyboard",
    "tab", "tab bar", "navigation", "navigate", "back button", "dark mode", "ui", "display",
    "text field", "popup", "pop-up", "splash", "drawer", "menu", "spinner", "animation",
    "landscape", "portrait", "tap", "swipe", "toast",
  ],
  backend: [
    "api", "servlet", "timeout", "timed out", "response", "socket", "feed", "price", "prices",
    "rate", "rates", "balance", "statement", "ledger", "order rejected", "not updating",
    "wrong data", "incorrect data", "sync", "latency", "login failed", "invalid pin",
    "otp not received", "otp", "settlement", "margin", "portfolio value", "holdings",
    "trade not executed", "delayed", "500", "server error",
  ],
  database: [
    "database", "db", "dba", "sql", "query", "queries", "deadlock", "duplicate records",
    "duplicate entries", "duplicate rows", "records missing", "data missing", "missing records",
    "stored procedure", "index", "table", "migration", "constraint", "data corruption",
    "rollback", "transaction", "replication", "slow query", "oracle", "postgres", "mysql",
  ],
  devops: [
    "deploy", "deployment", "deployed", "downtime", "outage", "server down", "ssl", "certificate",
    "dns", "502", "503", "504", "gateway", "bad gateway", "load balancer", "cpu", "memory",
    "disk", "disk full", "pipeline", "build failed", "environment", "staging", "uptime",
    "backup", "monitoring", "docker", "kubernetes", "nginx", "firewall", "vpn",
  ],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match, so "ui" doesn't hit "build" and "rate" doesn't hit "accurate". */
function hits(haystack: string, hint: string): boolean {
  const h = hint.trim().toLowerCase();
  if (!h) return false;
  return new RegExp(`(^|[^a-z0-9])${escape(h)}($|[^a-z0-9])`).test(haystack);
}

/**
 * Best-guess area for a bug: built-in hints (a phrase counts 2, a word 1), plus
 * each category's `keyword_hints` counted toward that category's `default_area`,
 * plus 2 for the chosen category's `default_area`. A tie returns null: no guess
 * beats a wrong one.
 */
export function suggestArea(
  text: string,
  categories: Pick<BugCategory, "id" | "keyword_hints" | "default_area">[] = [],
  categoryId?: string | null,
): { area: BugArea; matched: string[] } | null {
  const haystack = text.toLowerCase();
  const score = Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<BugArea, number>;
  const matched = Object.fromEntries(AREAS.map((a) => [a, [] as string[]])) as Record<BugArea, string[]>;

  const consider = (area: BugArea, list: string[] | null | undefined) => {
    for (const hint of list ?? []) {
      if (hits(haystack, hint) && !matched[area].includes(hint)) {
        // a phrase ("duplicate records") says more than one word ("statement")
        score[area] += hint.trim().includes(" ") ? 2 : 1;
        matched[area].push(hint);
      }
    }
  };
  for (const area of AREAS) consider(area, BUILTIN_HINTS[area]);
  for (const cat of categories) {
    if (isBugArea(cat.default_area)) consider(cat.default_area, cat.keyword_hints);
  }
  const chosen = categoryId ? categories.find((c) => c.id === categoryId) : null;
  if (chosen && isBugArea(chosen.default_area)) score[chosen.default_area] += 2;

  const best = Math.max(...AREAS.map((a) => score[a]));
  const top = AREAS.filter((a) => score[a] === best);
  if (best === 0 || top.length > 1) return null; // nothing, or a tie
  return { area: top[0], matched: matched[top[0]] };
}

/**
 * The area an automation test points at, from its pytest node id or file:
 * the API suite (akdapiautomation/) is backend, the Appium UI suite (tests/)
 * is frontend. Generated tests can be either, so they get null unless the
 * runner sends the area itself.
 */
export function areaFromTestKey(key: string | null | undefined): BugArea | null {
  const k = (key ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (k.startsWith("akdapiautomation/")) return "backend";
  if (k.startsWith("tests/")) return "frontend";
  return null;
}

/** A project's developers by area (migrations 0041, 0042); `none` = projects.assigned_developer_id. */
export type AreaDevelopers = { none: string | null } & Record<BugArea, string | null>;
export const NO_DEVELOPERS: AreaDevelopers = { none: null, frontend: null, backend: null, database: null, devops: null };

/**
 * The people to offer for an area: those with that skill, else (nobody has it
 * yet) every candidate, so a picker is never empty while skills are being set up.
 */
export function peopleForArea<T extends { skills?: unknown }>(
  people: T[],
  area: BugArea | null,
): { list: T[]; matched: boolean } {
  if (!area) return { list: people, matched: false };
  const skilled = people.filter((p) => skillsOf(p.skills).includes(area));
  return skilled.length ? { list: skilled, matched: true } : { list: people, matched: false };
}

/** Who a bug of this area goes to: the area's developer, else the project's developer. */
export function developerForArea(devs: AreaDevelopers, area: string | null | undefined): string | null {
  return (isBugArea(area) ? devs[area] : null) ?? devs.none;
}

/**
 * The update that moves a bug to `area`. With `reassign`, an open bug that is
 * unassigned or still with the developer its old area routed it to moves to the
 * new area's developer. A bug someone assigned by hand, or a lead handed to a
 * junior, keeps its assignee.
 */
export function areaPatch(
  bug: { area: string | null; assignee_id: string | null; status: string },
  area: BugArea | null,
  devs: AreaDevelopers,
  reassign = true,
): { area: BugArea | null; assignee_id?: string } {
  const patch: { area: BugArea | null; assignee_id?: string } = { area };
  if (!reassign || bug.status === "closed") return patch;
  const next = developerForArea(devs, area);
  const routed = !bug.assignee_id || bug.assignee_id === developerForArea(devs, bug.area);
  if (next && routed && next !== bug.assignee_id) patch.assignee_id = next;
  return patch;
}
