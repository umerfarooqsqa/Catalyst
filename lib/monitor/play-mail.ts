import "server-only";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { mailSeverity, matchMailProjects, type Warning } from "@/lib/monitor/rules";

/**
 * Play Console emails as app warnings (migration 0056): one card per email on each app it is
 * about, never cleared by a later check (only a person closes it). Fixed 2026-10-27 (0060):
 *  - one card per email, not per Gmail thread, so a follow-up ("final notice") notifies again;
 *  - an email listing several apps becomes a card on each of them;
 *  - an email naming no app rings App health (play_mail_unmatched_notify) and waits on the
 *    admin page to be assigned;
 *  - at most MAX_PER_CALL emails per call, with a fixed number of database requests per email,
 *    so a burst can't exceed Cloudflare's per-run request limit (the Apps Script sends batches).
 */
export type PlayMail = { id?: string; thread_id?: string; date?: string; from?: string; subject?: string; body?: string };

/** Emails taken per call; the Apps Script sends batches of this size and advances after each. */
export const MAX_PER_CALL = 10;

export function playMailWarning(m: Pick<PlayMail, "id" | "thread_id" | "date" | "from" | "subject" | "body">): Warning {
  const subject = (m.subject ?? "").trim() || "Google Play Console message";
  const body = (m.body ?? "").replace(/\s+/g, " ").trim();
  return {
    kind: "play_email",
    severity: mailSeverity(subject, body),
    fingerprint: `mail:${m.id || m.thread_id}`,
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

/**
 * Stores new mails (by Gmail message id) and files them. Takes the first MAX_PER_CALL and says
 * how many it took (`accepted`), so the caller resends the rest. Requests: 2 + 1 per app named
 * + 1 per unmatched mail + 2, whatever the batch holds.
 */
export async function receivePlayMails(messages: PlayMail[]) {
  const supabase = serviceRoleClient();
  const batch = messages.filter((m) => m?.id).slice(0, MAX_PER_CALL);
  const [{ data: projects }, { data: existing }] = await Promise.all([
    supabase.from("projects").select("id, name, android_package, house_slug").eq("platform", "android"),
    batch.length
      ? supabase.from("play_emails").select("message_id").in("message_id", batch.map((m) => String(m.id)))
      : Promise.resolve({ data: [] as { message_id: string }[] }),
  ]);
  const known = new Set((existing ?? []).map((r) => r.message_id));
  const list = (projects ?? []).map((p) => ({ id: p.id, name: p.name, package: p.android_package, house: p.house_slug }));
  const fresh = batch.filter((m) => !known.has(String(m.id)));

  // one sync per app with all of its new mails
  const perProject = new Map<string, Warning[]>();
  const matchedOf = new Map<string, string[]>();
  for (const m of fresh) {
    const ids = matchMailProjects(`${m.subject ?? ""}\n${m.body ?? ""}`, list);
    matchedOf.set(String(m.id), ids);
    for (const id of ids) perProject.set(id, [...(perProject.get(id) ?? []), playMailWarning(m)]);
  }
  for (const [projectId, items] of perProject) {
    const { error } = await supabase.rpc("app_warnings_sync", {
      p_project: projectId,
      p_source: "play_email",
      p_items: items as unknown as never,
      p_clear: false,
    });
    if (error) throw new Error(error.message);
  }
  for (const m of fresh) {
    if (!matchedOf.get(String(m.id))?.length) {
      await supabase.rpc("play_mail_unmatched_notify", { p_subject: m.subject ?? "" });
    }
  }

  // the card ids, then every mail row in one insert
  const fps = fresh.map((m) => playMailWarning(m).fingerprint);
  const { data: cards } = fps.length
    ? await supabase.from("app_warnings").select("id, project_id, fingerprint").in("fingerprint", fps)
    : { data: [] as { id: string; project_id: string; fingerprint: string }[] };
  if (fresh.length) {
    const { error } = await supabase.from("play_emails").insert(
      fresh.map((m) => {
        const ids = matchedOf.get(String(m.id)) ?? [];
        const fp = playMailWarning(m).fingerprint;
        const at = m.date && !Number.isNaN(Date.parse(m.date)) ? new Date(m.date).toISOString() : null;
        return {
          message_id: String(m.id),
          thread_id: m.thread_id ?? null,
          received_at: at,
          sender: m.from ?? null,
          subject: m.subject ?? null,
          excerpt: (m.body ?? "").replace(/\s+/g, " ").trim().slice(0, 2000) || null,
          project_id: ids[0] ?? null,
          warning_id: cards?.find((c) => c.fingerprint === fp && c.project_id === ids[0])?.id ?? null,
        };
      }),
    );
    if (error) throw new Error(error.message);
  }
  const matched = fresh.filter((m) => matchedOf.get(String(m.id))?.length).length;
  return {
    accepted: batch.length,
    received: fresh.length,
    matched,
    unmatched: fresh.length - matched,
    already_had: batch.length - fresh.length,
  };
}
