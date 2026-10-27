import "server-only";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { readBuildSdk, type BuildSdk } from "@/lib/monitor/apk";
import { accessToken, explainGoogleError, gcall, GoogleError, type ServiceAccountKey } from "@/lib/monitor/google";
import {
  rateWarning,
  releaseFacts,
  releaseWarnings,
  sameVersion,
  targetApiWarnings,
  type ReleaseFact,
  type ReleaseSummary,
  type TargetRule,
  type TrackRelease,
  type VersionTarget,
  type Warning,
} from "@/lib/monitor/rules";

/**
 * The cloud app monitor (migration 0056), run by POST /api/monitor/run when pg_cron pings it.
 * Each run does one due check (the sweep starts several runs in parallel):
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
    // upsert, then drop apps it no longer reaches: parallel runs may list the same key at once
    if (packages.length) {
      await supabase.from("play_key_apps").upsert(packages.map((p) => ({ key_id: key.id, package: p, seen_at: new Date().toISOString() })));
    }
    const { data: had } = await supabase.from("play_key_apps").select("package").eq("key_id", key.id);
    const gone = (had ?? []).map((r) => r.package).filter((p) => !packages.includes(p));
    if (gone.length) await supabase.from("play_key_apps").delete().eq("key_id", key.id).in("package", gone);
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

/** At most this many keys are listed or tried per Worker run (Cloudflare allows ~50 requests). */
const KEYS_PER_RUN = 2;

type KeyFound = { key: KeyRow; token: string } | { error: string; pending?: boolean; noKeys?: boolean };

/**
 * The key for a package: the one play_key_apps maps it to. While some keys haven't listed their
 * apps yet (or their list is a day old), up to KEYS_PER_RUN of them are listed per run and the
 * check says "pending" (retried soon, no card). Keys whose listing failed (e.g. the Reporting API
 * isn't enabled in their project) are tried directly with an edit, again KEYS_PER_RUN at a time.
 * Only when every key has been listed or tried and none reaches the app is it an error.
 */
async function keyFor(pkg: string): Promise<KeyFound> {
  const supabase = db();
  const { data: keys } = await supabase
    .from("play_keys")
    .select("id, name, client_email, gcp_project, apps_checked_at, last_error");
  if (!keys?.length) return { error: "No Google Play keys are uploaded (Admin → Google Play).", noKeys: true };
  const mapped = async () =>
    (await supabase.from("play_key_apps").select("key_id").eq("package", pkg)).data?.map((r) => r.key_id) ?? [];
  let ids = await mapped();
  const errors: string[] = [];
  for (const k of keys.filter((k) => ids.includes(k.id))) {
    try {
      return { key: k, token: await accessToken(await keyJson(k.id)) };
    } catch (e) {
      errors.push(`${k.name}: ${explainGoogleError(e)}`);
    }
  }
  if (errors.length) return { error: `The key for this app failed: ${errors.join("; ")}` };

  const dayAgo = Date.now() - 24 * 3600_000;
  const unlisted = keys.filter((k) => !k.apps_checked_at || Date.parse(k.apps_checked_at) < dayAgo);
  for (const k of unlisted.slice(0, KEYS_PER_RUN)) await refreshKeyApps(k);
  ids = await mapped();
  const hit = keys.find((k) => ids.includes(k.id));
  if (hit) return { key: hit, token: await accessToken(await keyJson(hit.id)) };
  if (unlisted.length > KEYS_PER_RUN) {
    return { error: "Still listing which apps each key reaches.", pending: true };
  }

  // keys whose app list couldn't be read: try them directly, a few per run
  const { data: tried } = await supabase.from("play_keys").select("id, last_error").not("last_error", "is", null);
  const candidates = keys.filter((k) => tried?.some((t) => t.id === k.id));
  for (const k of candidates.slice(0, KEYS_PER_RUN)) {
    try {
      const token = await accessToken(await keyJson(k.id));
      const edit = await gcall<{ id: string }>(token, `${PUB}/${pkg}/edits`, { body: {} });
      await gcall(token, `${PUB}/${pkg}/edits/${edit.id}`, { method: "DELETE" }).catch(() => undefined);
      await supabase.from("play_key_apps").upsert({ key_id: k.id, package: pkg });
      return { key: k, token };
    } catch {
      // this key can't read the app either
    }
  }
  return {
    error:
      "None of the uploaded keys can read this app. Invite a key's service account in this app's Play Console " +
      "(Users and permissions, View app information), or upload the key of the developer account that owns it.",
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

/**
 * Reads the SDK levels of the live and upcoming builds from Play (lib/monitor/apk.ts) into
 * play_builds, once per build; a failed read is retried after a day.
 */
async function readBuilds(token: string, pkg: string, facts: (ReleaseFact | null)[]) {
  const supabase = db();
  const wanted = facts.filter((f): f is ReleaseFact & { code: number } => !!f?.code);
  if (!wanted.length) return;
  const { data: known } = await supabase
    .from("play_builds")
    .select("version_code, target_sdk, read_at")
    .eq("package", pkg)
    .in("version_code", wanted.map((f) => f.code));
  const dayAgo = Date.now() - 24 * 3600_000;
  for (const f of wanted) {
    const row = known?.find((k) => k.version_code === f.code);
    if (row && (row.target_sdk !== null || Date.parse(row.read_at) > dayAgo)) continue;
    let sdk: BuildSdk | null = null;
    let error: string | null = null;
    try {
      sdk = await readBuildSdk(token, pkg, f.code);
    } catch (e) {
      // Play answers 404 "App Bundle version code could not be found" for a build uploaded as an APK
      error =
        e instanceof GoogleError && e.status === 404 && /app bundle/i.test(e.message)
          ? "the build was uploaded as an APK, not an app bundle, so Play has no copy to read it from"
          : explainGoogleError(e);
    }
    await supabase.from("play_builds").upsert({
      package: pkg, version_code: f.code, version_name: f.version,
      min_sdk: sdk?.minSdk ?? null, target_sdk: sdk?.targetSdk ?? null, error, read_at: new Date().toISOString(),
    });
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
        // a QA workflow reminder, not an app problem: listed on Admin -> Google Play, no card (0058)
        kind: "no_release_notes", severity: "warning", fingerprint: `portal:no_release_notes:${c.current_version}`,
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
  if ("error" in found && (found.pending || found.noKeys)) {
    throw new Error(found.error); // retried soon; not a card: nothing is wrong with the app
  }
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
      await readBuilds(found.token, c.package, [facts.live, facts.upcoming]);
      await sync(c.project_id, "releases", releaseWarnings(facts, lifecycle, c.current_version, c.project_id));
      await sync(c.project_id, "monitor_play", []);
    } catch (e) {
      if (e instanceof GoogleError && /app is suspended/i.test(e.message)) {
        // Play's API refuses every read of a suspended app: that refusal is the warning
        await sync(c.project_id, "releases", [{
          kind: "app_suspended", severity: "critical", fingerprint: "policy:suspended",
          title: "App is suspended on Google Play",
          detail: "Google Play suspended this app: users can't install or update it. Play Console's Policy status page says why and how to appeal.",
        }]);
        await sync(c.project_id, "monitor_play", []);
        await sync(c.project_id, "portal", []);
        return null;
      }
      problem = explainGoogleError(e);
      await sync(c.project_id, "monitor_play", [{
        kind: "play_error", severity: "critical", fingerprint: "monitor:play_error",
        title: "Reading this app's releases from Google Play failed", detail: problem, action_url: "/admin/google-play",
      }]);
    }
  }

  const [{ data: rules }, { data: versions }, { data: builds }] = await Promise.all([
    supabase.from("target_api_rules").select("applies_to, min_api, effective_date, extended_to, note"),
    supabase.from("releases").select("version, target_sdk").eq("project_id", c.project_id),
    supabase.from("play_builds").select("version_code, version_name, target_sdk, error").eq("package", c.package),
  ]);
  // Play's copy of the build wins (it is what users get); the portal's entry is the fallback
  const targetOf = (v: string | null): VersionTarget | null => {
    if (!v) return null;
    const play = (builds ?? [])
      .filter((b) => sameVersion(b.version_name, v))
      .sort((a, b) => b.version_code - a.version_code)[0];
    if (play?.target_sdk) return { version: v, target: play.target_sdk, fromPlay: true };
    const entered = versions?.find((r) => sameVersion(r.version, v))?.target_sdk ?? null;
    return { version: v, target: entered, readError: entered === null ? play?.error ?? null : null };
  };
  await sync(
    c.project_id,
    "target_api",
    targetApiWarnings({
      rules: (rules ?? []) as TargetRule[],
      today: new Date().toISOString().slice(0, 10),
      live: targetOf(liveVersion),
      upcoming: targetOf(c.current_version),
      warnDays: cfg.target_warn_days,
      projectId: c.project_id,
    }),
  );
  // a project added from Play (0059) has no versions or notes in the portal: nothing to check there
  const { data: proj } = await supabase.from("projects").select("added_from_play").eq("id", c.project_id).maybeSingle();
  await sync(c.project_id, "portal", proj?.added_from_play ? [] : await portalWarnings(c, liveVersion));
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
  if ("error" in found && (found.pending || found.noKeys)) {
    throw new Error(found.error);
  }
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

// ── apps with no project yet (0059) ────────────────────────────────────────────────────────

/** The app's Play Store name (its default-language listing title). */
async function playTitle(token: string, pkg: string): Promise<string | null> {
  const edit = await gcall<{ id: string }>(token, `${PUB}/${pkg}/edits`, { body: {} });
  try {
    const details = await gcall<{ defaultLanguage?: string }>(token, `${PUB}/${pkg}/edits/${edit.id}/details`);
    if (!details.defaultLanguage) return null;
    const listing = await gcall<{ title?: string }>(token, `${PUB}/${pkg}/edits/${edit.id}/listings/${details.defaultLanguage}`);
    return listing.title?.trim() || null;
  } finally {
    await gcall(token, `${PUB}/${pkg}/edits/${edit.id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

/**
 * Decided with the user (2026-10-27): every app the keys reach is watched, and one that no
 * project has gets its own project (play_app_adopt links it to a same-named Android project
 * that has no app yet, else creates one). One app per Worker run. A network or Google outage
 * leaves it for an hour later; an app Play won't describe (suspended, no access) is still added,
 * under its package name, so its warnings show.
 */
async function adoptOne(): Promise<{ project: string; check: string; ok: boolean; note: string | null } | null> {
  const supabase = db();
  const { data: picked } = await supabase.rpc("play_app_claim");
  const app = (picked as { package: string; key_id: string }[] | null)?.[0];
  if (!app) return null;
  let title: string | null = null;
  let note: string | null = null;
  try {
    title = await playTitle(await accessToken(await keyJson(app.key_id)), app.package);
  } catch (e) {
    note = explainGoogleError(e);
    if (!(e instanceof GoogleError) || e.status === 0 || e.status === 429 || e.status >= 500) {
      await supabase.from("play_key_apps").update({ adopt_error: note }).eq("key_id", app.key_id).eq("package", app.package);
      return { project: app.package, check: "adopt", ok: false, note };
    }
  }
  const { error } = await supabase.rpc("play_app_adopt", { p_package: app.package, p_title: title ?? app.package });
  if (error) note = error.message;
  await supabase.from("play_key_apps").update({ adopt_error: error ? note : null }).eq("key_id", app.key_id).eq("package", app.package);
  return { project: title ?? app.package, check: "adopt", ok: !error, note };
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────

/**
 * Runs ONE due check. Cloudflare allows ~50 outgoing requests per Worker invocation and a check
 * needs ~20-25, so the sweep pings the Worker once per due check instead (migration 0057).
 */
export async function runMonitor(): Promise<{ done: { project: string; check: string; ok: boolean; note: string | null }[] }> {
  const supabase = db();
  const done: { project: string; check: string; ok: boolean; note: string | null }[] = [];
  const { data: cfg } = await supabase.from("app_monitor_config").select("*").maybeSingle();
  if (!cfg?.enabled) return { done };
  const adopted = await adoptOne();
  if (adopted) return { done: [adopted] }; // its own run: adopting and checking won't both fit
  const { data: claims, error } = await supabase.rpc("monitor_claim", { p_limit: 1 });
  if (error) throw new Error(error.message);
  const c = (claims as Claim[] | null)?.[0];
  if (!c) return { done };
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
  return { done };
}
