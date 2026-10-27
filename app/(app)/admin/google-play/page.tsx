import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge } from "@/components/ui";
import LocalTime from "@/components/LocalTime";
import {
  AssignMail,
  ConfigForm,
  DeleteKeyButton,
  DeleteRuleButton,
  KeyUpload,
  MonitorSwitch,
  RuleForm,
  ScriptBox,
} from "@/components/GooglePlayAdmin";

export const dynamic = "force-dynamic";

/**
 * Admin -> Google Play (migration 0056): the cloud app monitor that turns every warning about
 * an Android app into a card in My Queue. Keys, which apps each reaches, how each app's
 * checks are doing, thresholds, target API rules, the Play-email Apps Script, and history.
 */

const th = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-700";

function appsScript(intakeUrl: string, key: string) {
  return `// Catalyst: forwards Google Play Console emails to catalyst, where each becomes an app warning.
// Paste into script.google.com while signed in to the Gmail that receives Play Console mail,
// run forwardPlayConsoleMail once (allow access), then add a time-driven trigger: every 10 minutes.
const CATALYST_URL = "${intakeUrl}";
const CATALYST_KEY = "${key}";
const QUERY = '(from:noreply-play-console@google.com OR from:googleplay-noreply@google.com OR ' +
              'from:google-play-noreply@google.com OR (from:google.com "Google Play Console"))';

function forwardPlayConsoleMail() {
  const props = PropertiesService.getScriptProperties();
  const since = Number(props.getProperty("since") || Date.now() - 7 * 86400000);
  const messages = [];
  // every thread with mail newer than "since", page by page
  for (let start = 0; ; start += 100) {
    const threads = GmailApp.search(QUERY + " after:" + Math.floor(since / 1000), start, 100);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (m.getDate().getTime() <= since) return;
        messages.push({ id: m.getId(), thread_id: thread.getId(), date: m.getDate().toISOString(), at: m.getDate().getTime(),
                        from: m.getFrom(), subject: m.getSubject(), body: m.getPlainBody().slice(0, 8000) });
      });
    });
    if (threads.length < 100) break;
  }
  // oldest first, a few at a time; "since" moves only past what catalyst took, so nothing is skipped
  messages.sort(function (a, b) { return a.at - b.at; });
  while (messages.length) {
    const batch = messages.slice(0, 10);
    const res = UrlFetchApp.fetch(CATALYST_URL, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-play-mail-key": CATALYST_KEY }, payload: JSON.stringify({ messages: batch }),
    });
    if (res.getResponseCode() !== 200) {
      throw new Error("catalyst answered " + res.getResponseCode() + ": " + res.getContentText());
    }
    const taken = Math.max(1, Number(JSON.parse(res.getContentText()).accepted) || batch.length);
    props.setProperty("since", String(batch[taken - 1].at));
    messages.splice(0, taken);
  }
}
`;
}

export default async function GooglePlayAdminPage() {
  const supabase = await createClient();
  const [
    { data: config },
    { data: keys },
    { data: keyApps },
    { data: checks },
    { data: rules },
    { data: mails },
    { data: history },
    { data: setup },
    { data: projects },
    { data: liveBuilds },
    { data: builds },
  ] = await Promise.all([
    supabase.from("app_monitor_config").select("*").maybeSingle(),
    supabase.from("play_keys").select("id, name, client_email, gcp_project, apps_checked_at, last_ok_at, last_error").order("name"),
    supabase.from("play_key_apps").select("key_id, package"),
    supabase
      .from("app_monitor_checks")
      .select("project_id, check, next_due_at, last_ok_at, last_error, projects(name, android_package, added_from_play)")
      .order("project_id"),
    supabase.from("target_api_rules").select("*").order("effective_date"),
    supabase.from("play_emails").select("id, received_at, sender, subject, project_id, warning_id, projects(name)").order("created_at", { ascending: false }).limit(30),
    supabase
      .from("app_warnings")
      .select("id, severity, title, status, active, first_seen_at, closed_at, close_note, reopened_count, projects(name), closer:profiles!app_warnings_closed_by_fkey(full_name)")
      .order("last_seen_at", { ascending: false })
      .limit(100),
    supabase.rpc("play_mail_setup"),
    supabase.from("projects").select("id, name").eq("platform", "android").order("name"),
    supabase.from("play_versions").select("project_id, live_version, live_code"),
    supabase.from("play_builds").select("package, version_code, target_sdk, error"),
  ]);
  // who gets the cards, bells and emails: the App health role category (migration 0058)
  const { data: members } = await supabase.from("profiles").select("full_name").contains("skills", ["app_health"]).order("full_name");

  if (!config) {
    return (
      <div>
        <PageHeader title="Google Play" />
        <Card className="p-4 text-sm text-slate-600">The app monitor isn&apos;t set up in the database yet (migration 0056).</Card>
      </div>
    );
  }

  const keyName = new Map((keys ?? []).map((k) => [k.id, k.name]));
  const appsOfKey = (id: string) => (keyApps ?? []).filter((a) => a.key_id === id).length;
  const keyOfPackage = (pkg: string | null | undefined) =>
    (keyApps ?? []).filter((a) => a.package === pkg).map((a) => keyName.get(a.key_id)).join(", ");
  const apps = new Map<string, { name: string; pkg: string | null; fromPlay: boolean; play?: (typeof checks & object)[number]; vitals?: (typeof checks & object)[number] }>();
  for (const c of checks ?? []) {
    const row = apps.get(c.project_id) ?? {
      name: c.projects?.name ?? "?",
      pkg: c.projects?.android_package ?? null,
      fromPlay: !!c.projects?.added_from_play,
    };
    row[c.check as "play" | "vitals"] = c;
    apps.set(c.project_id, row);
  }
  // the live build and its target SDK as read from Play (migration 0059)
  const liveOf = (id: string, pkg: string | null) => {
    const live = (liveBuilds ?? []).find((v) => v.project_id === id);
    if (!live?.live_code) return <span className="text-slate-400">not live</span>;
    const b = (builds ?? []).find((x) => x.package === pkg && x.version_code === live.live_code);
    return (
      <div>
        {live.live_version ?? "?"} <span className="text-slate-400">(build {live.live_code})</span>
        <div>
          {b?.target_sdk ? (
            <span className={rules?.some((r) => r.applies_to === "existing" && r.effective_date <= today && b.target_sdk! < r.min_api) ? "font-semibold text-red-600" : ""}>
              API {b.target_sdk}
            </span>
          ) : (
            <span className="text-amber-700" title={b?.error ?? undefined}>
              {b?.error ? "target SDK unknown" : "not read yet"}
            </span>
          )}
        </div>
      </div>
    );
  };
  const today = new Date().toISOString().slice(0, 10);
  const s = (setup ?? {}) as { key?: string; monitor_url?: string };
  const origin = (() => {
    try {
      return new URL(s.monitor_url ?? "").origin;
    } catch {
      return "";
    }
  })();
  const status = (c?: { last_ok_at: string | null; last_error: string | null; next_due_at: string }) =>
    !c ? (
      <span className="text-slate-400">—</span>
    ) : (
      <div>
        {c.last_ok_at ? (
          <span>
            OK <LocalTime value={c.last_ok_at} />
          </span>
        ) : (
          <span className="text-slate-400">not yet</span>
        )}
        {c.last_error ? <div className="text-red-600">{c.last_error}</div> : null}
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Play"
        subtitle="Checks every Android app in the cloud every 5 minutes (Play releases, Android vitals, target API deadlines, portal state, Play Console emails). Serious problems become cards in My Queue for the App health role category; everything is listed here."
      />

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Monitoring</h2>
          {config.enabled ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}
          <span className="text-xs text-slate-500">
            {apps.size} apps · {(keys ?? []).length} keys
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-600">
          Only <b>serious</b> problems become cards, bells and emails, and only for the <b>App health</b> role category:{" "}
          {(members ?? []).length ? (members ?? []).map((m) => m.full_name).join(", ") : <b className="text-red-600">nobody yet</b>}.{" "}
          <Link href="/admin/role-categories" className="text-brand-fg hover:underline">
            Change who&apos;s in it
          </Link>
          . Amber warnings and the monitor&apos;s own problems are only listed in History below.
        </p>
        {!config.enabled ? (
          <p className="mb-3 text-xs text-slate-600">
            Upload the keys first, then turn monitoring on. Until then nothing is checked and nobody is notified.
          </p>
        ) : null}
        <MonitorSwitch enabled={config.enabled} />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Keys</h2>
        <KeyUpload />
        {(keys ?? []).length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Service account</th>
                  <th className={th}>Apps it reaches</th>
                  <th className={th}>Last OK</th>
                  <th className={th}>Problem</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {(keys ?? []).map((k) => (
                  <tr key={k.id} className="border-t border-grid-line">
                    <td className={td}>{k.name}</td>
                    <td className={td}>
                      {k.client_email}
                      <div className="text-slate-400">{k.gcp_project}</div>
                    </td>
                    <td className={td}>{k.apps_checked_at ? appsOfKey(k.id) : <span className="text-slate-400">not listed yet</span>}</td>
                    <td className={td}>{k.last_ok_at ? <LocalTime value={k.last_ok_at} /> : "—"}</td>
                    <td className={`${td} text-red-600`}>{k.last_error}</td>
                    <td className={td}>
                      <DeleteKeyButton id={k.id} name={k.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Apps</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>App</th>
                <th className={th}>Key</th>
                <th className={th}>Live on Play</th>
                <th className={th}>Play, target API, portal</th>
                <th className={th}>Android vitals</th>
              </tr>
            </thead>
            <tbody>
              {[...apps.entries()]
                .sort((a, b) => a[1].name.localeCompare(b[1].name))
                .map(([id, a]) => (
                  <tr key={id} className="border-t border-grid-line">
                    <td className={td}>
                      <Link href={`/projects/${id}/settings`} className="font-medium text-brand-fg hover:underline">
                        {a.name}
                      </Link>
                      <div className="text-slate-400">{a.pkg}</div>
                      {a.fromPlay ? <Badge tone="slate">added from Play</Badge> : null}
                    </td>
                    <td className={td}>{keyOfPackage(a.pkg) || <span className="text-slate-400">none yet</span>}</td>
                    <td className={td}>{liveOf(id, a.pkg)}</td>
                    <td className={td}>{status(a.play)}</td>
                    <td className={td}>{status(a.vitals)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          An app is checked when its project is Android and has a package (project Settings). The key for each app is found
          by itself. Every other app the keys reach gets a project by itself (&quot;added from Play&quot;). The target SDK is read
          from Play&apos;s copy of the live build; apps uploaded as plain APKs can&apos;t be read and show &quot;target SDK
          unknown&quot;.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Thresholds and intervals</h2>
        <ConfigForm config={config as unknown as Record<string, number | boolean>} />
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Target API level rules</h2>
        <p className="mb-3 text-xs text-slate-500">
          Google&apos;s requirements (Play Console Help, &quot;Target API level requirements&quot;). Add the next rule when Google
          announces it. Each live build&apos;s target SDK is read from Google Play; the portal&apos;s entry is the fallback.
        </p>
        <table className="mb-4 w-full">
          <thead>
            <tr>
              <th className={th}>From</th>
              <th className={th}>Applies to</th>
              <th className={th}>Minimum API</th>
              <th className={th}>Note</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {(rules ?? []).map((r) => (
              <tr key={r.id} className="border-t border-grid-line">
                <td className={td}>
                  {r.effective_date}
                  {r.extended_to ? <div className="text-slate-400">extension to {r.extended_to}</div> : null}
                </td>
                <td className={td}>{r.applies_to === "updates" ? "New apps and updates" : "Existing apps"}</td>
                <td className={td}>{r.min_api}</td>
                <td className={td}>{r.note}</td>
                <td className={td}>
                  <DeleteRuleButton id={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <RuleForm />
      </Card>

      <div id="mails" />
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Play Console emails</h2>
        <p className="mb-3 text-xs text-slate-500">
          Policy issues, Inbox messages and removal notices only arrive by email. This Google Apps Script runs on Google&apos;s
          servers in the Gmail that receives them and forwards them here every 10 minutes. Each email naming an app becomes a
          card on it.
        </p>
        {s.key && origin ? <ScriptBox script={appsScript(`${origin}/api/intake/play-mail`, s.key)} /> : null}
        {(mails ?? []).length ? (
          <table className="mt-4 w-full">
            <thead>
              <tr>
                <th className={th}>Received</th>
                <th className={th}>Subject</th>
                <th className={th}>App</th>
              </tr>
            </thead>
            <tbody>
              {(mails ?? []).map((m) => (
                <tr key={m.id} className="border-t border-grid-line">
                  <td className={td}>{m.received_at ? <LocalTime value={m.received_at} /> : "—"}</td>
                  <td className={td}>
                    {m.subject}
                    <div className="text-slate-400">{m.sender}</div>
                  </td>
                  <td className={td}>
                    {m.project_id ? m.projects?.name : <AssignMail mailId={m.id} projects={projects ?? []} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-xs text-slate-400">No Play Console emails received yet.</p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">History (latest 100 warnings)</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>App</th>
                <th className={th}>Warning</th>
                <th className={th}>State</th>
                <th className={th}>Since</th>
                <th className={th}>Closed</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((w) => (
                <tr key={w.id} className="border-t border-grid-line">
                  <td className={td}>{w.projects?.name}</td>
                  <td className={td}>
                    <Badge tone={w.severity === "critical" ? "red" : "amber"}>{w.severity === "critical" ? "Critical" : "Warning"}</Badge>{" "}
                    {w.title}
                  </td>
                  <td className={td}>
                    {w.status === "open" ? "Open" : "Closed"}
                    {!w.active ? ", cleared" : ""}
                    {w.reopened_count ? `, back ${w.reopened_count}×` : ""}
                  </td>
                  <td className={td}>
                    <LocalTime value={w.first_seen_at} />
                  </td>
                  <td className={td}>
                    {w.closed_at ? (
                      <>
                        <LocalTime value={w.closed_at} />
                        {w.closer?.full_name ? ` by ${w.closer.full_name}` : ""}
                        {w.close_note ? <div className="text-slate-500">{w.close_note}</div> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
