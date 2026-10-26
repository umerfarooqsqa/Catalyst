/**
 * The app monitor's decisions (migration 0056), as pure functions: what Play's releases, the
 * target API rules, the vitals and a Play Console email mean as warnings. No I/O here, so
 * every rule can be checked on its own. Decided with the user (2026-10-26):
 *  - upcoming = a production draft / staged / halted rollout newer than live (testing tracks
 *    don't count); red when its version differs from the version QA is testing, or when
 *    production is already newer than that version (it went live without QA);
 *  - stability: amber at early_share of Google's bad-behaviour limit, red over it;
 *  - target SDK comes from the portal (releases.target_sdk): no Google API returns it.
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

/** "102 (1.0.6)" -> "1.0.6" (Play's default release name); a bare "1.0.6"/"v1.0.6" as is; else null. */
export function versionName(releaseName: string | null | undefined): string | null {
  let name = String(releaseName ?? "").trim();
  const m = /^\d+\s*\((.+)\)$/.exec(name);
  if (m) name = m[1].trim();
  return /^v?\d+(\.\d+)+$/i.test(name) ? name.replace(/^v/i, "") : null;
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

/** live = production completed; upcoming = a production draft / staged / halted rollout newer than live. */
export function releaseFacts(production: TrackRelease[]): { live: ReleaseFact | null; upcoming: ReleaseFact | null } {
  const all = production.map(fact);
  const live = newest(all.filter((r) => r.status === "completed"));
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
  } else if (upcoming && currentVersion && !sameVersion(upcoming.version, currentVersion)) {
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

export type TargetRule = { applies_to: "updates" | "existing"; min_api: number; effective_date: string; note?: string | null };
export type VersionTarget = { version: string; target: number | null };

function ruleState(rules: TargetRule[], appliesTo: TargetRule["applies_to"], today: string) {
  const mine = rules.filter((r) => r.applies_to === appliesTo).sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const inForce = mine.filter((r) => r.effective_date <= today).pop() ?? null;
  const next = mine.find((r) => r.effective_date > today) ?? null;
  return { inForce, next };
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * live: the version users have (its target SDK from the portal); upcoming: the version QA is
 * testing, which will be the next update. today: "YYYY-MM-DD".
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
    title: `Target SDK isn't entered for ${which} version ${v.version}`,
    detail: "Google has no API for an app's target SDK, so catalyst reads it from the version. Add it in App versions on the Bugs page (or with the release notes).",
    action_url: url,
  });
  const check = (v: VersionTarget, appliesTo: TargetRule["applies_to"], which: string) => {
    const { inForce, next } = ruleState(rules, appliesTo, today);
    if (v.target === null) return;
    if (inForce && v.target < inForce.min_api) {
      out.push(
        appliesTo === "existing"
          ? {
              kind: "target_api", severity: "critical", fingerprint: `target:existing:${v.version}:${inForce.min_api}`,
              title: `${which[0].toUpperCase() + which.slice(1)} version ${v.version} targets API ${v.target}: new users on newer Android can't install it`,
              detail: `${inForce.note ?? ""} Required since ${inForce.effective_date}: API ${inForce.min_api} or higher. Publish an update that targets API ${inForce.min_api}+.`.trim(),
              action_url: url, data: { target: v.target, required: inForce.min_api, since: inForce.effective_date },
            }
          : {
              kind: "target_api", severity: "critical", fingerprint: `target:updates:${v.version}:${inForce.min_api}`,
              title: `${which[0].toUpperCase() + which.slice(1)} version ${v.version} targets API ${v.target}: Google Play will refuse it as an update`,
              detail: `${inForce.note ?? ""} Required since ${inForce.effective_date}: API ${inForce.min_api} or higher. Raise targetSdkVersion before releasing.`.trim(),
              action_url: url, data: { target: v.target, required: inForce.min_api, since: inForce.effective_date },
            },
      );
    } else if (next && v.target < next.min_api && daysBetween(today, next.effective_date) <= warnDays) {
      out.push({
        kind: "target_api_soon", severity: "warning", fingerprint: `target:${appliesTo}:${v.version}:${next.min_api}`,
        title: `${which[0].toUpperCase() + which.slice(1)} version ${v.version} targets API ${v.target}; API ${next.min_api} is required from ${next.effective_date} (${daysBetween(today, next.effective_date)} days)`,
        detail: `${next.note ?? ""} ${appliesTo === "existing" ? "After that date, new users on newer Android can't install it." : "After that date, Google Play won't accept updates below it."}`.trim(),
        action_url: url, data: { target: v.target, required: next.min_api, from: next.effective_date },
      });
    }
  };
  // The live version must meet the rule for existing apps; the version QA is testing (the next
  // update) the rule for updates. When both are the same version, its target is asked for once.
  if (live) {
    if (live.target === null) out.push(missing(live, "the live"));
    else check(live, "existing", "the live");
  }
  if (upcoming) {
    const same = !!live && sameVersion(live.version, upcoming.version);
    const target = upcoming.target ?? (same ? live!.target : null);
    if (target === null) {
      if (!same) out.push(missing(upcoming, "the upcoming"));
    } else {
      check({ version: upcoming.version, target }, "updates", "the upcoming");
    }
  }
  return out;
}

// ── vitals ───────────────────────────────────────────────────────────────────────────────

/** Amber at early * limit, red over limit, else null. */
export function levelOf(rate: number, limit: number, early: number): Severity | null {
  if (!Number.isFinite(rate)) return null;
  if (rate > limit) return "critical";
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
    title: `${opts.what} ${pct(opts.rate)}${opts.scope ? ` ${opts.scope}` : ""}: ${sev === "critical" ? "over" : "close to"} Google's ${pct(opts.limit)} limit`,
    detail: `${sev === "critical" ? opts.consequence : `It's at ${Math.round((opts.rate / opts.limit) * 100)}% of the limit.`} Last 28 days${opts.dataUpTo ? `, data up to ${opts.dataUpTo}` : ""}.`,
    data: { rate: opts.rate, limit: opts.limit },
  };
}

// ── Play Console emails ────────────────────────────────────────────────────────────────────

const CRITICAL_MAIL =
  /\b(remov(ed|al)|suspend|reject|terminat|violation|action required|take action|deadline|unpublish|will not be able|won'?t be able|blocked|restricted|policy (issue|status)|enforcement|limited visibility)\b/i;

export function mailSeverity(subject: string, body: string): Severity {
  return CRITICAL_MAIL.test(`${subject}\n${body}`) ? "critical" : "warning";
}

export type MailProject = { id: string; name: string; package: string | null; house: string | null };

/** The project a Play Console email is about: its package name, else exactly one project's name. */
export function matchMailProject(text: string, projects: MailProject[]): string | null {
  const lower = text.toLowerCase();
  const byPackage = projects.filter((p) => p.package && lower.includes(p.package.toLowerCase()));
  if (byPackage.length === 1) return byPackage[0].id;
  const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const byName = projects.filter((p) => {
    const n = norm(p.name);
    return n.length >= 4 && new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower);
  });
  return byName.length === 1 ? byName[0].id : null;
}
