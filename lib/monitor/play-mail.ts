import "server-only";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { mailSeverity, matchMailProject, type Warning } from "@/lib/monitor/rules";

/**
 * Play Console emails as app warnings (migration 0056): one card per mail thread on the app
 * the mail is about, never cleared by a later check (only a person closes it).
 */
export type PlayMail = { id?: string; thread_id?: string; date?: string; from?: string; subject?: string; body?: string };

export function playMailWarning(m: Pick<PlayMail, "id" | "thread_id" | "date" | "from" | "subject" | "body">): Warning {
  const subject = (m.subject ?? "").trim() || "Google Play Console message";
  const body = (m.body ?? "").replace(/\s+/g, " ").trim();
  return {
    kind: "play_email",
    severity: mailSeverity(subject, body),
    fingerprint: `mail:${m.thread_id || m.id}`,
    title: `Play Console: ${subject}`.slice(0, 300),
    detail: body.slice(0, 900) || undefined,
    action_url: m.thread_id ? `https://mail.google.com/mail/u/0/#all/${m.thread_id}` : undefined,
    data: { from: m.from ?? null, date: m.date ?? null },
  };
}

/** Files one mail as a card on a project and returns the card's id. */
export async function fileMailOnProject(m: PlayMail, projectId: string): Promise<string | null> {
  const supabase = serviceRoleClient();
  const w = playMailWarning(m);
  const { error } = await supabase.rpc("app_warnings_sync", {
    p_project: projectId,
    p_source: "play_email",
    p_items: [w] as unknown as never,
    p_clear: false,
  });
  if (error) throw new Error(error.message);
  const { data } = await supabase
    .from("app_warnings")
    .select("id")
    .eq("project_id", projectId)
    .eq("fingerprint", w.fingerprint)
    .maybeSingle();
  return data?.id ?? null;
}

/** Stores new mails (by Gmail message id) and files the ones that name an app. */
export async function receivePlayMails(messages: PlayMail[]) {
  const supabase = serviceRoleClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, android_package, house_slug")
    .eq("platform", "android");
  const list = (projects ?? []).map((p) => ({ id: p.id, name: p.name, package: p.android_package, house: p.house_slug }));
  let received = 0;
  let matched = 0;
  let unmatched = 0;
  let known = 0;
  for (const m of messages) {
    if (!m?.id) continue;
    const { data: existing } = await supabase.from("play_emails").select("id").eq("message_id", String(m.id)).maybeSingle();
    if (existing) {
      known++;
      continue;
    }
    received++;
    const projectId = matchMailProject(`${m.subject ?? ""}\n${m.body ?? ""}`, list);
    const warningId = projectId ? await fileMailOnProject(m, projectId) : null;
    if (projectId) matched++;
    else unmatched++;
    const at = m.date && !Number.isNaN(Date.parse(m.date)) ? new Date(m.date).toISOString() : null;
    await supabase.from("play_emails").insert({
      message_id: String(m.id),
      thread_id: m.thread_id ?? null,
      received_at: at,
      sender: m.from ?? null,
      subject: m.subject ?? null,
      excerpt: (m.body ?? "").replace(/\s+/g, " ").trim().slice(0, 2000) || null,
      project_id: projectId,
      warning_id: warningId,
    });
  }
  return { received, matched, unmatched, already_had: known };
}
