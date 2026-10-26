import "server-only";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { accessToken, explainGoogleError, gcall, GoogleError, type ServiceAccountKey } from "@/lib/monitor/google";
import {
  rateWarning,
  releaseFacts,
  releaseWarnings,
  sameVersion,
  targetApiWarnings,
  type ReleaseSummary,
  type TargetRule,
  type TrackRelease,
  type Warning,
} from "@/lib/monitor/rules";

/**
 * The cloud app monitor (migration 0056), run by POST /api/monitor/run when pg_cron pings it.
 * Claims due checks one at a time within a time budget:
 *  - 'play'   : Play releases (+ play_versions facts), target API level, portal state;
 *  - 'vitals' : Android vitals from the Play Developer Reporting API.
 * Each source's findings replace that source's previous ones (app_warnings_sync). When Google
 * can't be reached, the source is left as it was and a monitor warning says why, so a failed
 * call never clears a real card.
 */

const PUB = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const REP = "https://playdeveloperreporting.googleapis.com/v1beta1";

type Claim = {
  project_id: string;
  check: "play" | "vitals";
  project_name: string;
  package: string;
  current_version: string | null;
  house_slug: string | null;
  last_ok_at: string | null;
};
type Config = {
  early_share: number;
  crash_limit: number;
  anr_limit: number;
  device_limit: number;
  wakelock_limit: number;
  device_min_users: number;
  new_crash_min_users: number;
  target_warn_days: number;
};
type KeyRow = { id: string; name: string; client_email: string; gcp_project: string | null; apps_checked_at: string | null };

const db = () => serviceRoleClient();
const num = (v: unknown) => Number(v);

async function sync(projectId: string, source: string, items: Warning[]) {
  const { error } = await db().rpc("app_warnings_sync", {
    p_project: projectId,
    p_source: source,
    p_items: items as unknown as never,
  });
  if (error) throw new Error(`saving ${source} warnings: ${error.message}`);
}

// ── keys ───────────────────────────────────────────────────────────────────────────────────

const keyCache = new Map<string, ServiceAccountKey>();
async function keyJson(id: string): Promise<ServiceAccountKey> {
  const hit = keyCache.get(id);
  if (hit) return hit;
  const { data, error } = await db().rpc("play_key_secret", { p_id: id });
  if (error || !data) throw new Error(`reading the key from Vault: ${error?.message ?? "missing"}`);
  const key = data as unknown as ServiceAccountKey;
  keyCache.set(id, key);
  return key;
}

/** Lists the apps one key reaches (Reporting API) into play_key_apps. */
async function refreshKeyApps(key: KeyRow): Promise<void> {
  const supabase = db();
  try {
    const token = await accessToken(await keyJson(key.id));
    const packages: string[] = [];
    let page = "";
    do {
      const res = await gcall<{ apps?: { packageName?: string }[]; nextPageToken?: string }>(
        token,
        `${REP}/apps:search?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      );
      for (const a of res.apps ?? []) if (a.packageName) packages.push(a.packageName);
      page = res.nextPageToken ?? "";
    } while (page);
    await supabase.from("play_key_apps").delete().eq("key_id", key.id);
    if (packages.length) {
      await supabase.from("play_key_apps").insert(packages.map((p) => ({ key_id: key.id, package: p })));
    }
    await supabase
      .from("play_keys")
      .update({ apps_checked_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_error: null })
      .eq("id", key.id);
  } catch (e) {
    await supabase
      .from("play_keys")
      .update({ apps_checked_at: new Date().toISOString(), last_error: explainGoogleError(e) })
      .eq("id", key.id);
  }
}

/**
 * The key for a package: the one play_key_apps maps it to. Keys whose app list is a day old
 * (or never read) are listed again first; if still nothing, each key is tried directly with
 * the Publishing API (works even where the Reporting API isn't enabled yet).
 */
async function keyFor(pkg: string): Promise<{ key: KeyRow; token: string } | { error: string }> {
  const supabase = db();
  const { data: keys } = await supabase
    .from("play_keys")
    .select("id, name, client_email, gcp_project, apps_checked_at");
  if (!keys?.length) return { error: "No Google Play keys are uploaded (Admin → Google Play)." };
  const mapped = async () =>
    (await supabase.from("play_key_apps").select("key_id").eq("package", pkg)).data?.map((r) => r.key_id) ?? [];
  let ids = await mapped();
  if (!ids.length) {
    const dayAgo = Date.now() - 24 * 3600_000;
    for (const k of keys) {
      if (!k.apps_checked_at || Date.parse(k.apps_checked_at) < dayAgo) await refreshKeyApps(k);
    }
    ids = await mapped();
  }
  const errors: string[] = [];
  for (const k of [...keys.filter((k) => ids.includes(k.id)), ...keys.filter((k) => !ids.includes(k.id))]) {
    try {
      const token = await accessToken(await keyJson(k.id));
      if (!ids.includes(k.id)) {
        // not listed for this app: prove it can read it before using it
        const edit = await gcall<{ id: string }>(token, `${PUB}/${pkg}/edits`, { body: {} });
        await gcall(token, `${PUB}/${pkg}/edits/${edit.id}`, { method: "DELETE" }).catch(() => undefined);
        await supabase.from("play_key_apps").upsert({ key_id: k.id, package: pkg });
      }
      return { key: k, token };
    } catch (e) {
      if (ids.includes(k.id)) errors.push(`${k.name}: ${explainGoogleError(e)}`);
    }
  }
  return {
    error: errors.length
      ? `The key for this app failed: ${errors.join("; ")}`
      : "None of the uploaded keys can read this app. Invite a key's service account in this app's Play Console (Users and permissions, View app information).",
  };
}

// ── the 'play' check ───────────────────────────────────────────────────────────────────────

async function playReleases(token: string, pkg: string) {
  const edit = await gcall<{ id: string }>(token, `${PUB}/${pkg}/edits`, { body: {} });
  try {
    const track = await gcall<{ releases?: TrackRelease[] }>(token, `${PUB}/${pkg}/edits/${edit.id}/tracks/production`);
    let lifecycle: ReleaseSummary[] = [];
    try {
      lifecycle = (await gcall<{ releases?: ReleaseSummary[] }>(token, `${PUB}/${pkg}/tracks/production/releases`)).releases ?? [];
    } catch {
      // review state is a bonus: the facts above are enough for the version checks
    }
    return { production: track.releases ?? [], lifecycle };
  } finally {
    await gcall(token, `${PUB}/${pkg}/edits/${edit.id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function portalWarnings(c: Claim, liveVersion: string | null): Promise<Warning[]> {
  const supabase = db();
  const out: Warning[] = [];
  const settings = `/projects/${c.project_id}/settings`;
  const { data: releases } = await supabase
    .from("releases")
    .select("id, version, release_notes_ref")
    .eq("project_id", c.project_id);
  if (!c.current_version) {
    out.push({
      kind: "no_version", severity: "warning", fingerprint: "portal:no_version",
      title: "No current version is set for this app",
      detail: "Automation can't start and Play can't be compared until the project has a current version (add its release notes).",
      action_url: settings,
    });
  } else {
    const cur = releases?.find((r) => sameVersion(r.version, c.current_version));
    if (!cur?.release_notes_ref) {
      out.push({
        kind: "no_release_notes", severity: "critical", fingerprint: `portal:no_release_notes:${c.current_version}`,
        title: `Version ${c.current_version} has no release notes`,
        detail: "Testing can't start for this version until its release notes are in the portal (start gate).",
        action_url: settings,
      });
    }
  }
  const live = liveVersion ? releases?.find((r) => sameVersion(r.version, liveVersion)) : null;
  if (live) {
    const { count } = await supabase
      .from("bugs")
      .select("id", { count: "exact", head: true })
      .eq("release_id", live.id)
      .eq("severity", "critical")
      .in("status", ["open", "in_progress", "reopened"]);
    if (count) {
      out.push({
        kind: "critical_bugs_live", severity: "critical", fingerprint: `portal:critical_bugs:${live.version}`,
        title: `${count} critical bug${count === 1 ? "" : "s"} still open on live version ${live.version}`,
        detail: "Users have this version now.",
        action_url: `/projects/${c.project_id}/bugs`,
        data: { count },
      });
    }
  }
  return out;
}

async function checkPlay(c: Claim, cfg: Config): Promise<string | null> {
  const supabase = db();
  const found = await keyFor(c.package);
  let liveVersion: string | null = null;
  let problem: string | null = null;
  if ("error" in found) {
    await sync(c.project_id, "monitor_play", [{
      kind: "no_play_access", severity: "critical", fingerprint: "monitor:no_play_access",
      title: "Google Play can't be checked for this app", detail: found.error, action_url: "/admin/google-play",
    }]);
    const { data: pv } = await supabase.from("play_versions").select("live_version").eq("project_id", c.project_id).maybeSingle();
    liveVersion = pv?.live_version ?? null;
    problem = found.error;
  } else {
    try {
      const { production, lifecycle } = await playReleases(found.token, c.package);
      const facts = releaseFacts(production);
      liveVersion = facts.live?.version ?? null;
      await supabase.from("play_versions").upsert(
        {
          project_id: c.project_id, package: c.package, play_key: found.key.name, reachable: true, error: null,
          live_version: facts.live?.version ?? null, live_code: facts.live?.code ?? null,
          upcoming_version: facts.upcoming?.version ?? null, upcoming_code: facts.upcoming?.code ?? null,
          upcoming_track: facts.upcoming ? "production" : null, upcoming_status: facts.upcoming?.status ?? null,
          upcoming_fraction: facts.upcoming?.fraction ?? null,
          snapshot_date: new Date().toISOString().slice(0, 10), checked_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );
      await sync(c.project_id, "releases", releaseWarnings(facts, lifecycle, c.current_version, c.project_id));
      await sync(c.project_id, "monitor_play", []);
    } catch (e) {
      problem = explainGoogleError(e);
      await sync(c.project_id, "monitor_play", [{
        kind: "play_error", severity: "critical", fingerprint: "monitor:play_error",
        title: "Reading this app's releases from Google Play failed", detail: problem, action_url: "/admin/google-play",
      }]);
    }
  }

  const [{ data: rules }, { data: versions }] = await Promise.all([
    supabase.from("target_api_rules").select("applies_to, min_api, effective_date, note"),
    supabase.from("releases").select("version, target_sdk").eq("project_id", c.project_id),
  ]);
  const targetOf = (v: string | null) => (v ? versions?.find((r) => sameVersion(r.version, v))?.target_sdk ?? null : null);
  await sync(
    c.project_id,
    "target_api",
    targetApiWarnings({
      rules: (rules ?? []) as TargetRule[],
      today: new Date().toISOString().slice(0, 10),
      live: liveVersion ? { version: liveVersion, target: targetOf(liveVersion) } : null,
      upcoming: c.current_version ? { version: c.current_version, target: targetOf(c.current_version) } : null,
      warnDays: cfg.target_warn_days,
      projectId: c.project_id,
    }),
  );
  await sync(c.project_id, "portal", await portalWarnings(c, liveVersion));
  return problem;
}

// ── the 'vitals' check ─────────────────────────────────────────────────────────────────────

type Ymd = { year: number; month: number; day: number };
type MetricRow = { dimensions?: { dimension: string; stringValue?: string; valueLabel?: string }[]; metrics?: { metric: string; decimalValue?: { value?: string } }[] };

const LA = { id: "America/Los_Angeles" };
const shift = (d: Ymd, days: number): Ymd => {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
};
const ymdText = (d: Ymd) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const metric = (row: MetricRow, name: string) => num(row.metrics?.find((m) => m.metric === name)?.decimalValue?.value);

/** The latest day a metric set has data for (DAILY, Los Angeles time), or null. */
async function latestDay(token: string, pkg: string, set: string): Promise<Ymd | null> {
  const res = await gcall<{ freshnessInfo?: { freshnesses?: { aggregationPeriod?: string; latestEndTime?: Ymd }[] } }>(
    token,
    `${REP}/apps/${pkg}/${set}`,
  );
  const end = res.freshnessInfo?.freshnesses?.find((f) => f.aggregationPeriod === "DAILY")?.latestEndTime;
  return end ? { year: end.year, month: end.month, day: end.day } : null;
}

async function queryDay(token: string, pkg: string, set: string, end: Ymd, metrics: string[], dimensions: string[] = []) {
  const start = shift(end, -1);
  const res = await gcall<{ rows?: MetricRow[] }>(token, `${REP}/apps/${pkg}/${set}:query`, {
    body: {
      timelineSpec: { aggregationPeriod: "DAILY", startTime: { ...start, timeZone: LA }, endTime: { ...end, timeZone: LA } },
      metrics,
      dimensions,
      pageSize: 1000,
    },
  });
  return res.rows ?? [];
}

async function checkVitals(c: Claim, cfg: Config): Promise<string | null> {
  const supabase = db();
  const found = await keyFor(c.package);
  if ("error" in found) {
    await sync(c.project_id, "monitor_vitals", [{
      kind: "no_vitals_access", severity: "critical", fingerprint: "monitor:no_vitals_access",
      title: "Android vitals can't be checked for this app", detail: found.error, action_url: "/admin/google-play",
    }]);
    return found.error;
  }
  const { token, key } = found;
  const out: Warning[] = [];
  const notes: string[] = [];
  const early = cfg.early_share;
  const rates: { set: string; metric: string; kind: string; what: string; limit: number; consequence: string; perDevice: boolean }[] = [
    { set: "crashRateMetricSet", metric: "userPerceivedCrashRate28dUserWeighted", kind: "crash_rate", what: "User-perceived crash rate",
      limit: cfg.crash_limit, perDevice: true,
      consequence: "Over Google's bad-behaviour threshold: Google Play may show the app less and warn users on its store listing." },
    { set: "anrRateMetricSet", metric: "userPerceivedAnrRate28dUserWeighted", kind: "anr_rate", what: "User-perceived ANR rate",
      limit: cfg.anr_limit, perDevice: true,
      consequence: "Over Google's bad-behaviour threshold: Google Play may show the app less and warn users on its store listing." },
    { set: "stuckBackgroundWakelockRateMetricSet", metric: "stuckBgWakelockRate28dUserWeighted", kind: "wakelock_rate",
      what: "Stuck background wake lock rate", limit: cfg.wakelock_limit, perDevice: false,
      consequence: "Over Google's excessive wake lock threshold: it drains batteries, and Google Play may show the app less." },
  ];
  let reached = 0;
  for (const r of rates) {
    try {
      const day = await latestDay(token, c.package, r.set);
      if (!day) continue;
      reached++;
      const upTo = ymdText(shift(day, -1));
      const [overall] = await queryDay(token, c.package, r.set, day, [r.metric, "distinctUsers"]);
      if (overall) {
        const w = rateWarning({
          kind: r.kind, what: r.what, rate: metric(overall, r.metric), limit: r.limit, early,
          fingerprint: `vitals:${r.kind}`, dataUpTo: upTo, consequence: r.consequence,
        });
        if (w) out.push({ ...w, action_url: `https://play.google.com/console` });
      }
      if (r.perDevice) {
        const rows = await queryDay(token, c.package, r.set, day, [r.metric, "distinctUsers"], ["deviceModel"]);
        rows
          .filter((row) => metric(row, "distinctUsers") >= cfg.device_min_users)
          .map((row) => {
            const model = row.dimensions?.[0]?.valueLabel || row.dimensions?.[0]?.stringValue || "?";
            return rateWarning({
              kind: `${r.kind}_device`, what: r.what, rate: metric(row, r.metric), limit: cfg.device_limit, early,
              fingerprint: `vitals:${r.kind}:device:${row.dimensions?.[0]?.stringValue ?? model}`, scope: `on ${model}`,
              dataUpTo: upTo, consequence: "Over Google's per-device threshold: the app may be hidden or flagged for users of this phone model.",
            });
          })
          .filter((w): w is Warning => !!w)
          .sort((a, b) => num(b.data?.rate) - num(a.data?.rate))
          .slice(0, 3)
          .forEach((w) => out.push(w));
      }
    } catch (e) {
      notes.push(`${r.what}: ${explainGoogleError(e)}`);
      if (e instanceof GoogleError && e.reason === "SERVICE_DISABLED") break;
    }
  }

  // Google's own spike detection, last 7 days
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
    const res = await gcall<{ anomalies?: { name: string; metricSet?: string; metric?: { metric?: string; decimalValue?: { value?: string } }; dimensions?: { dimension: string; stringValue?: string; valueLabel?: string }[] }[] }>(
      token,
      `${REP}/apps/${c.package}/anomalies?pageSize=50&filter=${encodeURIComponent(`activeBetween("${since}", UNBOUNDED)`)}`,
    );
    reached++;
    for (const a of res.anomalies ?? []) {
      const what = (a.metric?.metric ?? a.metricSet ?? "a vital").replace(/([A-Z])/g, " $1").toLowerCase();
      const dims = (a.dimensions ?? []).map((d) => d.valueLabel || d.stringValue).filter(Boolean).join(", ");
      out.push({
        kind: "vitals_anomaly", severity: "warning", fingerprint: `vitals:anomaly:${a.name}`,
        title: `Google detected an unusual spike in ${what}${dims ? ` (${dims})` : ""}`,
        detail: a.metric?.decimalValue?.value ? `Value during the spike: ${a.metric.decimalValue.value}.` : undefined,
        action_url: "https://play.google.com/console",
      });
    }
  } catch (e) {
    notes.push(`anomalies: ${explainGoogleError(e)}`);
  }

  // a crash cluster new in the live build, affecting enough users
  const { data: pv } = await supabase.from("play_versions").select("live_code, live_version").eq("project_id", c.project_id).maybeSingle();
  if (pv?.live_code) {
    try {
      const res = await gcall<{ errorIssues?: { name: string; type?: string; cause?: string; location?: string; distinctUsers?: string; distinctUsersPercent?: { value?: string }; issueUri?: string; firstAppVersion?: { versionCode?: string } }[] }>(
        token,
        `${REP}/apps/${c.package}/errorIssues:search?pageSize=5&orderBy=${encodeURIComponent("distinctUsers desc")}&filter=${encodeURIComponent(`versionCode = ${pv.live_code}`)}`,
      );
      reached++;
      for (const i of res.errorIssues ?? []) {
        const users = num(i.distinctUsers);
        const share = num(i.distinctUsersPercent?.value) / 100;
        if (num(i.firstAppVersion?.versionCode) !== pv.live_code || !(users >= cfg.new_crash_min_users)) continue;
        out.push({
          kind: "new_crash", severity: share >= cfg.crash_limit ? "critical" : "warning",
          fingerprint: `vitals:new_crash:${i.name}`,
          title: `New ${i.type === "APPLICATION_NOT_RESPONDING" ? "ANR" : "crash"} in live version ${pv.live_version ?? pv.live_code}: ${i.cause ?? "unknown cause"}`,
          detail: `${users} users${Number.isFinite(share) ? ` (${(share * 100).toFixed(2)}%)` : ""} in the last day${i.location ? `, at ${i.location}` : ""}. First seen in this build.`,
          action_url: i.issueUri ?? "https://play.google.com/console",
        });
      }
    } catch (e) {
      notes.push(`crash clusters: ${explainGoogleError(e)}`);
    }
  }

  if (!reached) {
    // nothing could be read: keep the last vitals cards, say why
    const disabled = notes.some((n) => n.includes("API not enabled"));
    await sync(c.project_id, "monitor_vitals", [{
      kind: disabled ? "reporting_api_disabled" : "vitals_error", severity: disabled ? "warning" : "critical",
      fingerprint: "monitor:vitals_error",
      title: disabled
        ? `The Play Developer Reporting API isn't enabled for key ${key.name}`
        : "Reading Android vitals from Google Play failed",
      detail: disabled
        ? `Enable "Google Play Developer Reporting API" in Cloud project ${key.gcp_project ?? "?"}. Until then this app's vitals aren't checked.`
        : notes.join("; "),
      action_url: "/admin/google-play",
    }]);
    return disabled ? null : notes.join("; ");
  }
  await sync(c.project_id, "vitals", out);
  await sync(c.project_id, "monitor_vitals", []);
  return notes.length ? notes.join("; ") : null;
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────

export async function runMonitor(budgetMs = 20_000): Promise<{ done: { project: string; check: string; ok: boolean; note: string | null }[] }> {
  const started = Date.now();
  const supabase = db();
  const done: { project: string; check: string; ok: boolean; note: string | null }[] = [];
  const { data: cfg } = await supabase.from("app_monitor_config").select("*").maybeSingle();
  if (!cfg?.enabled) return { done };
  while (Date.now() - started < budgetMs) {
    const { data: claims, error } = await supabase.rpc("monitor_claim", { p_limit: 1 });
    if (error) throw new Error(error.message);
    const c = (claims as Claim[] | null)?.[0];
    if (!c) break;
    let note: string | null = null;
    let ok = true;
    try {
      note = c.check === "vitals" ? await checkVitals(c, cfg as Config) : await checkPlay(c, cfg as Config);
    } catch (e) {
      ok = false;
      note = e instanceof Error ? e.message : String(e);
    }
    await supabase.rpc("monitor_done", { p_project: c.project_id, p_check: c.check, p_ok: ok, p_error: note ?? undefined });
    done.push({ project: c.project_name, check: c.check, ok, note });
  }
  return { done };
}
