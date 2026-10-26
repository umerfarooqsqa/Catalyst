"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { canAdminister } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { fileMailOnProject } from "@/lib/monitor/play-mail";

/**
 * Admin -> Google Play (migration 0056): keys, monitor settings, target API rules, run now,
 * and assigning a Play Console email that named no app. Keys go straight into Vault through
 * play_key_put (which checks the admin itself); nothing here returns a key.
 */

const PAGE = "/admin/google-play";

async function adminSession() {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Only an admin can change Google Play settings.");
  return createClient();
}

export async function addPlayKeys(files: { name: string; text: string }[]): Promise<{ added: string[]; errors: string[] }> {
  const supabase = await adminSession();
  const added: string[] = [];
  const errors: string[] = [];
  for (const f of files.slice(0, 50)) {
    let json: unknown;
    try {
      json = JSON.parse(f.text);
    } catch {
      errors.push(`${f.name}: not a JSON file`);
      continue;
    }
    const name = f.name.replace(/\.json$/i, "");
    const { error } = await supabase.rpc("play_key_put", { p_name: name, p_key: json as never });
    if (error) errors.push(`${f.name}: ${error.message}`);
    else added.push(name);
  }
  if (added.length) {
    // new keys: list their apps on the next run, and run the checks now
    const { admin } = await getAdminClient();
    await admin.from("app_monitor_checks").update({ next_due_at: new Date().toISOString() }).in("check", ["play", "vitals"]);
    await admin.rpc("app_monitor_kick");
  }
  revalidatePath(PAGE);
  return { added, errors };
}

export async function deletePlayKey(id: string): Promise<{ error?: string }> {
  const supabase = await adminSession();
  const { error } = await supabase.rpc("play_key_delete", { p_id: id });
  revalidatePath(PAGE);
  return error ? { error: error.message } : {};
}

export async function saveMonitorConfig(values: Record<string, number | boolean>): Promise<{ error?: string }> {
  const supabase = await adminSession();
  const allowed = [
    "enabled", "early_share", "crash_limit", "anr_limit", "device_limit", "wakelock_limit", "device_min_users",
    "new_crash_min_users", "play_minutes", "vitals_minutes", "stale_minutes", "target_warn_days",
  ];
  const patch = Object.fromEntries(Object.entries(values).filter(([k]) => allowed.includes(k)));
  const { error } = await supabase
    .from("app_monitor_config")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (!error && patch.enabled === true) {
    const { admin } = await getAdminClient();
    await admin.rpc("app_monitor_kick");
  }
  revalidatePath(PAGE);
  return error ? { error: error.message } : {};
}

export async function runChecksNow(): Promise<{ error?: string }> {
  const { admin } = await getAdminClient();
  const { error } = await admin.from("app_monitor_checks").update({ next_due_at: new Date().toISOString(), attempts: 0 }).in("check", ["play", "vitals"]);
  if (error) return { error: error.message };
  await admin.rpc("app_monitor_kick");
  revalidatePath(PAGE);
  return {};
}

export async function addTargetRule(appliesTo: "updates" | "existing", minApi: number, effectiveDate: string, note: string) {
  const supabase = await adminSession();
  const { error } = await supabase
    .from("target_api_rules")
    .insert({ applies_to: appliesTo, min_api: minApi, effective_date: effectiveDate, note: note || null });
  if (!error) await recheckAll();
  revalidatePath(PAGE);
  return error ? { error: error.message } : {};
}

export async function deleteTargetRule(id: string) {
  const supabase = await adminSession();
  const { error } = await supabase.from("target_api_rules").delete().eq("id", id);
  if (!error) await recheckAll();
  revalidatePath(PAGE);
  return error ? { error: error.message } : {};
}

async function recheckAll() {
  const { admin } = await getAdminClient();
  await admin.from("app_monitor_checks").update({ next_due_at: new Date().toISOString() }).eq("check", "play");
  await admin.rpc("app_monitor_kick");
}

/** A Play Console email that named no app: file it on the app a person chose. */
export async function assignPlayMail(mailId: string, projectId: string): Promise<{ error?: string }> {
  const { admin } = await getAdminClient();
  const { data: m } = await admin.from("play_emails").select("*").eq("id", mailId).maybeSingle();
  if (!m) return { error: "No such email." };
  try {
    const warningId = await fileMailOnProject(
      { id: m.message_id, thread_id: m.thread_id ?? undefined, date: m.received_at ?? undefined, from: m.sender ?? undefined,
        subject: m.subject ?? undefined, body: m.excerpt ?? undefined },
      projectId,
    );
    await admin.from("play_emails").update({ project_id: projectId, warning_id: warningId }).eq("id", mailId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(PAGE);
  return {};
}
