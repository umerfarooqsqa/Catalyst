/**
 * The app monitor's decisions (migration 0056), as pure functions: what Play's releases, the
 * target API rules, the vitals and a Play Console email mean as warnings. No I/O here, so
 * every rule can be checked on its own. Decided with the user (2026-10-26):
 *  - upcoming = a production draft / staged / halted rollout newer than live (testing tracks
 *    don't count); red when its version differs from the version QA is testing, or when
 *    production is already newer than that version (it went live without QA);
 *  - stability: amber at early_share of Google's bad-behaviour limit, red over it;
 *  - target SDK: read from Play's copy of each build (lib/monitor/apk.ts, 0059), else from the
 *    portal (releases.target_sdk). No Google API field returns it.
 */

export type Severity = "critical" | "warning";
export type Warning = {
  kind: string;
  severity: Severity;
  fingerprint: string;
  title: string;
  detail?: string;
  action_url?: string;
  data?: Record<string, unknown>;
};

// ── versions ──────────────────────────────────────────────────────────────────────────────

/**
 * "102 (1.0.6)" -> "1.0.6" (Play's default release name); a bare "1.0.6"/"v1.0.6" as is; a
 * suffixed "1.0.6-hotfix" / "1.0.6 hotfix" -> "1.0.6"; else null (a custom name such as
 * "4.5 - Re-Login Button": the build code identifies it then).
 */
export function versionName(releaseName: string | null | undefined): string | null {
  let name = String(releaseName ?? "").trim();
  const m = /^\d+\s*\((.+)\)$/.exec(name);
  if (m) name = m[1].trim();
  const v = /^v?(\d+(?:\.\d+)+)(?:[-+_ ][\w.-]*)?$/i.exec(name);
  return v ? v[1] : null;
}

function parts(v: string | null | undefined): number[] | null {
  const s = String(v ?? "").trim().replace(/^v/i, "");
  return /^\d+(\.\d+)*$/.test(s) ? s.split(".").map(Number) : null;
}

/** <0, 0, >0 like a sort comparator; null when either isn't a dotted number. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const c = compareVersions(a, b);
  return c === null ? String(a ?? "").trim() === String(b ?? "").trim() : c === 0;
}

// ── Play releases ─────────────────────────────────────────────────────────────────────────

export type TrackRelease = { name?: string; status?: string; versionCodes?: string[]; userFraction?: number };
export type ReleaseFact = { version: string | null; code: number | null; status: string; fraction: number | null; name: string };
export type ReleaseSummary = { releaseName?: string; releaseLifecycleState?: string; activeArtifacts?: { versionCode?: number | string }[] };

const codeOf = (r: TrackRelease) => {
  const codes = (r.versionCodes ?? []).map(Number).filter(Number.isFinite);
  return codes.length ? Math.max(...codes) : null;
};
const fact = (r: TrackRelease): ReleaseFact => ({
  version: versionName(r.name),
  code: codeOf(r),
  status: r.status ?? "",
  fraction: typeof r.userFraction === "number" ? r.userFraction : null,
  name: r.name ?? "",
});
const newest = (rs: ReleaseFact[]) => (rs.length ? rs.reduce((a, b) => ((b.code ?? 0) > (a.code ?? 0) ? b : a)) : null);

/**
 * live = production completed (an app whose only production release is still a staged or
 * halted rollout: that rollout, since users have it); upcoming = a production draft / staged /
 * halted rollout newer than live.
 */
export function releaseFacts(production: TrackRelease[]): { live: ReleaseFact | null; upcoming: ReleaseFact | null } {
  const all = production.map(fact);
  const live =
    newest(all.filter((r) => r.status === "completed")) ??
    newest(all.filter((r) => ["inProgress", "halted"].includes(r.status) && r.code !== null));
  const upcoming = newest(
    all.filter(
      (r) => ["draft", "inProgress", "halted"].includes(r.status) && r.code !== null && r.code > (live?.code ?? 0),
    ),
  );
  return { live, upcoming };
}

const STATUS_WORDS: Record<string, string> = { draft: "draft", inProgress: "staged rollout", halted: "halted rollout" };
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function releaseWarnings(
  facts: { live: ReleaseFact | null; upcoming: ReleaseFact | null },
  lifecycle: ReleaseSummary[],
  currentVersion: string | null,
  projectId: string,
): Warning[] {
  const out: Warning[] = [];
  const settings = `/projects/${projectId}/settings`;
  const { live, upcoming } = facts;
  if (upcoming && !upcoming.version) {
    out.push({
      kind: "release_name", severity: "warning", fingerprint: "release:unknown_name",
      title: `The upcoming release "${upcoming.name}" doesn't show its version`,
      detail: 'Play names a release "<build> (<version>)" unless someone renames it. Without the version, catalyst can\'t compare it with the version QA is testing.',
    });
  } else if (
    upcoming &&
    currentVersion &&
    upcoming.code !== live?.code &&
    !sameVersion(upcoming.version, currentVersion) &&
    // QA already moved on to a newer version while this one finishes rolling out: not a mismatch
    !((compareVersions(upcoming.version, currentVersion) ?? 1) < 0)
  ) {
    const share = upcoming.fraction ? ` to ${pct(upcoming.fraction)} of users` : "";
    out.push({
      kind: "version_mismatch", severity: "critical", fingerprint: "release:version_mismatch",
      title: `Play is about to ship ${upcoming.version} (build ${upcoming.code}), but QA is testing ${currentVersion}`,
      detail: `Production ${STATUS_WORDS[upcoming.status] ?? upcoming.status}${share}. Test ${upcoming.version}, or set the project's version to it.`,
      action_url: settings,
      data: { play_version: upcoming.version, play_code: upcoming.code, status: upcoming.status, fraction: upcoming.fraction, tested: currentVersion },
    });
  }
  if (live?.version && currentVersion && (compareVersions(live.version, currentVersion) ?? 0) > 0) {
    out.push({
      kind: "untested_live", severity: "critical", fingerprint: "release:untested_live",
      title: `Play already ships ${live.version} (build ${live.code}) to users, but QA tested ${currentVersion}`,
      detail: `This version went live without QA. Test ${live.version} and set the project's version to it.`,
      action_url: settings,
      data: { play_version: live.version, play_code: live.code, tested: currentVersion },
    });
  }
  if (upcoming?.status === "halted") {
    out.push({
      kind: "rollout_halted", severity: "warning", fingerprint: `release:halted:${upcoming.code}`,
      title: `The rollout of ${upcoming.version ?? upcoming.name} (build ${upcoming.code}) is halted`,
      detail: "Someone stopped this production rollout in Play Console. Users who already got it keep it; nobody else does.",
    });
  }
  for (const r of lifecycle) {
    if (r.releaseLifecycleState === "RELEASE_LIFECYCLE_STATE_NOT_APPROVED" || r.releaseLifecycleState === "NOT_APPROVED") {
      out.push({
        kind: "release_rejected", severity: "critical", fingerprint: `release:rejected:${r.releaseName ?? "?"}`,
        title: `Google rejected the release ${r.releaseName ?? ""} in review`,
        detail: "The release was not approved by Google Play's review. Play Console's Publishing overview and Inbox say why.",
      });
    }
  }
  return out;
}

// ── target API level ──────────────────────────────────────────────────────────────────────

export type TargetRule = {
  applies_to: "updates" | "existing";
  min_api: number;
  effective_date: string;
  extended_to?: string | null; // Google's extension (2026: updates until Nov 1)
  note?: string | null;
};
/** fromPlay: read from Play's copy of the build (0059); readError: why Play couldn't give it. */
export type VersionTarget = { version: string; target: number | null; fromPlay?: boolean; readError?: string | null };

function ruleState(rules: TargetRule[], appliesTo: TargetRule["applies_to"], today: string) {
  const mine = rules.filter((r) => r.applies_to === appliesTo).sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const inForce = mine.filter((r) => r.effective_date <= today).pop() ?? null;
  const next = mine.find((r) => r.effective_date > today) ?? null;
  return { inForce, next };
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** 36 -> "Android 16 (API level 36)", as Play Console words it. */
export const androidName = (api: number) => (api >= 29 ? `Android ${api - 20} (API level ${api})` : `API level ${api}`);
/** "2026-11-01" -> "Nov 1, 2026". */
export const dayText = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The target-API part of Play Console's Policy status, worked out from the rules (Google has no
 * API for that page). live: the version users have; upcoming: the version QA is testing, which
 * will be the next update. Targets come from Play's copy of the build when it can be read, else
 * from the portal. today: "YYYY-MM-DD". Cards use Play Console's own wording:
 *  - "App not available to new users on Android versions higher than your target API level"
 *    (live below the rule for existing apps);
 *  - "App updates with this target API level will be rejected" (live below the rule for
 *    updates: the next update must be raised), with Google's extension date as "Fix by";
 *  - the version QA is testing is below the rule for updates (Play would refuse it);
 *  - a coming deadline within warnDays (amber).
 */
export function targetApiWarnings(opts: {
  rules: TargetRule[];
  today: string;
  live: VersionTarget | null;
  upcoming: VersionTarget | null;
  warnDays: number;
  projectId: string;
}): Warning[] {
  const { rules, today, live, upcoming, warnDays, projectId } = opts;
  const out: Warning[] = [];
  const url = `/projects/${projectId}/bugs`;
  const missing = (v: VersionTarget, which: string): Warning => ({
    kind: "target_sdk_missing", severity: "warning", fingerprint: `target:missing:${v.version}`,
    title: `Target SDK unknown for ${which} version ${v.version}`,
    detail: v.readError
      ? `Google Play couldn't give it (${v.readError}). Enter it in App versions on the Bugs page (or with the release notes).`
      : "It is read from Google Play once the build is on Play; until then, enter it in App versions on the Bugs page (or with the release notes).",
    action_url: url,
  });
  const existing = ruleState(rules, "existing", today);
  const updates = ruleState(rules, "updates", today);
  const graceDays = (r: TargetRule) => (r.extended_to && r.extended_to > today ? daysBetween(today, r.extended_to) : null);
  const soon = (v: VersionTarget, r: TargetRule | null, which: string, after: string) => {
    if (!r || v.target === null || v.target >= r.min_api) return;
    const days = daysBetween(today, r.effective_date);
    if (days > warnDays) return;
    out.push({
      kind: "target_api_soon", severity: "warning", fingerprint: `target:${r.applies_to}:${v.version}:${r.min_api}`,
      title: `${which} ${v.version} targets API ${v.target}: ${androidName(r.min_api)} is required from ${dayText(r.effective_date)} (${plural(days, "day")} away)`,
      detail: `${r.note ?? ""} ${after}`.trim(),
      action_url: url, data: { target: v.target, required: r.min_api, from: r.effective_date },
    });
  };

  if (live) {
    if (live.target === null) {
      out.push(missing(live, "the live"));
    } else {
      const ex = existing.inForce;
      if (ex && live.target < ex.min_api) {
        out.push({
          kind: "target_api", severity: "critical", fingerprint: `policy:existing:${ex.min_api}`,
          title: "App not available to new users on Android versions higher than your target API level",
          detail: `App must target ${androidName(ex.min_api)} or higher. The live version ${live.version} targets API ${live.target}. Reduced availability from ${dayText(ex.effective_date)}. Publish an update that targets API ${Math.max(ex.min_api, updates.inForce?.min_api ?? 0)} or higher.`,
          action_url: url, data: { version: live.version, target: live.target, required: ex.min_api, since: ex.effective_date },
        });
      }
      const up = updates.inForce;
      if (up && live.target < up.min_api) {
        const grace = graceDays(up);
        const fixedBy =
          upcoming && upcoming.target !== null && upcoming.target >= up.min_api && !sameVersion(upcoming.version, live.version)
            ? ` Version ${upcoming.version}, which QA is testing, targets API ${upcoming.target} and fixes this once it is published.`
            : "";
        out.push({
          kind: "target_api", severity: "critical", fingerprint: `policy:updates:${up.min_api}`,
          title:
            grace !== null
              ? `App updates will be rejected: must target ${androidName(up.min_api)}. Fix by ${dayText(up.extended_to!)} (${plural(grace, "day")} away)`
              : `App updates are rejected: must target ${androidName(up.min_api)} or higher`,
          detail:
            (grace !== null
              ? `The live version ${live.version} targets API ${live.target}. Google's extension ends ${dayText(up.extended_to!)}; after that Play rejects every update below API ${up.min_api}.`
              : `The live version ${live.version} targets API ${live.target}. Since ${dayText(up.effective_date)}, Play rejects every update below API ${up.min_api}.`) + fixedBy,
          action_url: url,
          data: { version: live.version, target: live.target, required: up.min_api, since: up.effective_date, extended_to: up.extended_to ?? null },
        });
      }
      soon(live, existing.next, "The live version", "After that date, new users on newer Android can't install it.");
    }
  }

  if (upcoming && !(live && sameVersion(live.version, upcoming.version))) {
    if (upcoming.target === null) {
      out.push(missing(upcoming, "the upcoming"));
    } else {
      const up = updates.inForce;
      const liveCard = up ? out.find((w) => w.fingerprint === `policy:updates:${up.min_api}`) : undefined;
      if (up && upcoming.target < up.min_api && liveCard) {
        // same rule, same fix: one red card, which also names the tested version
        liveCard.detail = `${liveCard.detail ?? ""} Version ${upcoming.version}, which QA is testing, targets API ${upcoming.target} too, so Play would reject it as well: raise targetSdkVersion before releasing.`;
      } else if (up && upcoming.target < up.min_api) {
        const grace = graceDays(up);
        out.push({
          kind: "target_api", severity: "critical", fingerprint: `target:updates:${upcoming.version}:${up.min_api}`,
          title: `Version ${upcoming.version} (QA is testing) targets API ${upcoming.target}: Google Play will reject it as an update`,
          detail: `App updates must target ${androidName(up.min_api)} or higher${grace !== null ? ` (Google's extension ends ${dayText(up.extended_to!)})` : ""}. Raise targetSdkVersion before releasing.`,
          action_url: url, data: { target: upcoming.target, required: up.min_api, since: up.effective_date },
        });
      } else {
        soon(upcoming, updates.next, "Version", "After that date, Google Play won't accept updates below it.");
      }
    }
  }
  return out;
}

// ── vitals ───────────────────────────────────────────────────────────────────────────────

/** Rates under 10% with two decimals, so a rate and its limit never read the same ("1.05% … 1.09%"). */
const ratePct = (x: number) => (x < 0.1 ? `${(x * 100).toFixed(2)}%` : pct(x));

/** Amber at early * limit, red at or over the limit (Google's thresholds are "at or above"), else null. */
export function levelOf(rate: number, limit: number, early: number): Severity | null {
  if (!Number.isFinite(rate)) return null;
  if (rate >= limit) return "critical";
  if (rate >= limit * early) return "warning";
  return null;
}

export function rateWarning(opts: {
  kind: string;
  what: string; // "User-perceived crash rate"
  rate: number;
  limit: number;
  early: number;
  fingerprint: string;
  scope?: string; // "on Samsung SM-A125F"
  dataUpTo?: string | null;
  consequence: string;
}): Warning | null {
  const sev = levelOf(opts.rate, opts.limit, opts.early);
  if (!sev) return null;
  return {
    kind: opts.kind,
    severity: sev,
    fingerprint: opts.fingerprint,
    title: `${opts.what} ${ratePct(opts.rate)}${opts.scope ? ` ${opts.scope}` : ""}: ${sev === "critical" ? "over" : "close to"} Google's ${ratePct(opts.limit)} limit`,
    detail: `${sev === "critical" ? opts.consequence : `It's at ${Math.round((opts.rate / opts.limit) * 100)}% of the limit.`} Last 28 days${opts.dataUpTo ? `, data up to ${opts.dataUpTo}` : ""}.`,
    data: { rate: opts.rate, limit: opts.limit },
  };
}

// ── Play Console emails ────────────────────────────────────────────────────────────────────

// Stems match every form ("suspended", "suspension", "rejected", "termination"); a bare
// "deadline" doesn't count (newsletters use it), Google's action wording does.
const CRITICAL_MAIL = new RegExp(
  [
    String.raw`\b(remov|suspen|reject|terminat|violat|unpublish|restrict|enforc|block)\w*`,
    String.raw`\bnot (been )?approved\b`,
    String.raw`\bnot (be )?available\b`,
    String.raw`\baction (is )?required\b`,
    String.raw`\btake action\b`,
    String.raw`\b(will not|won'?t) be able\b`,
    String.raw`\bpolicy (issue|status|violation|update)`,
    String.raw`\b(reduced|limited) (visibility|availability)\b`,
    String.raw`\bvisibility (is )?reduced\b`,
    String.raw`\btarget api\b`,
    String.raw`\bmust target\b`,
    String.raw`\bdata safety\b`,
    String.raw`\bdeclaration`,
    String.raw`\bverify your (identity|account|developer)`,
    String.raw`\baccount (will be |has been |is )?clos`,
    String.raw`\bclos(e|ing) your (developer )?account\b`,
  ].join("|"),
  "i",
);

export function mailSeverity(subject: string, body: string): Severity {
  return CRITICAL_MAIL.test(`${subject}\n${body}`) ? "critical" : "warning";
}

export type MailProject = { id: string; name: string; package: string | null; house: string | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The projects a Play Console email is about. A package counts only as a whole name
 * ("com.catalyst.hmfs" isn't inside "com.catalyst.hmfsit"), and a mail listing several apps is
 * about each of them. Without a package: the app's name, where a longer name containing a
 * shorter one wins ("AHL Tick Next Generation" over "AHL Tick"); still ambiguous = none.
 */
export function matchMailProjects(text: string, projects: MailProject[]): string[] {
  const lower = text.toLowerCase();
  const byPackage = projects.filter(
    (p) => p.package && new RegExp(`(^|[^a-z0-9_.])${escapeRe(p.package.toLowerCase())}(?![a-z0-9_])`).test(lower),
  );
  if (byPackage.length) return [...new Set(byPackage.map((p) => p.id))];
  const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const hits = projects
    .map((p) => ({ id: p.id, n: norm(p.name) }))
    .filter(({ n }) => n.length >= 4 && new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(lower));
  const names = [...new Set(hits.map((h) => h.n))];
  const longest = names.filter((n) => !names.some((m) => m !== n && m.includes(n)));
  if (longest.length !== 1) return [];
  const ids = hits.filter((h) => h.n === longest[0]).map((h) => h.id);
  return ids.length === 1 ? ids : [];
}

/** The one project a Play Console email is about, or null. */
export function matchMailProject(text: string, projects: MailProject[]): string | null {
  const ids = matchMailProjects(text, projects);
  return ids.length === 1 ? ids[0] : null;
}
