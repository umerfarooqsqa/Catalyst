"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import type { Database } from "@/lib/types/database";

export type EmailSettings = Database["public"]["Tables"]["project_email_settings"]["Row"];
export type EmailStats = Database["public"]["Functions"]["email_stats"]["Returns"][number];
type Mode = EmailSettings["mode"];

const DEFAULTS = { mode: "auto_batch" as Mode, batch_size: 5, fallback_hours: 4, digest_time: "09:00" };

const MODE_LABELS: Record<Mode, string> = {
  instant: "Instant",
  auto_batch: "Auto-batch",
  daily_digest: "Daily digest",
};

/**
 * "Email" on the Bugs page (migration 0044), QA/admin only: today's sending against the daily
 * quota, what is waiting in batches, and this project's email mode. The quota is shared by
 * every project (one sending account), so both counters are portal-wide.
 */
export default function EmailModePanel({
  projectId,
  userId,
  settings,
  stats,
}: {
  projectId: string;
  userId: string;
  settings: EmailSettings | null;
  stats: EmailStats | null;
}) {
  const router = useRouter();
  const current = {
    mode: settings?.mode ?? DEFAULTS.mode,
    batch_size: settings?.batch_size ?? DEFAULTS.batch_size,
    fallback_hours: settings?.fallback_hours ?? DEFAULTS.fallback_hours,
    digest_time: (settings?.digest_time ?? DEFAULTS.digest_time).slice(0, 5),
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const summary =
    current.mode === "instant"
      ? "one email per bug event"
      : current.mode === "auto_batch"
        ? `one email per ${current.batch_size} bugs, or after ${current.fallback_hours} h`
        : `one summary a day at ${current.digest_time}`;

  async function save() {
    setErr(null);
    const n = Number(form.batch_size);
    const h = Number(form.fallback_hours);
    if (!Number.isInteger(n) || n < 1 || n > 50) return setErr("Bugs per email must be 1–50.");
    if (!Number.isInteger(h) || h < 1 || h > 72) return setErr("Send-anyway hours must be 1–72.");
    setBusy(true);
    const { error } = await createClient()
      .from("project_email_settings")
      .upsert({
        project_id: projectId,
        mode: form.mode,
        batch_size: n,
        fallback_hours: h,
        digest_time: form.digest_time,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });
    setBusy(false);
    if (error) return setErr(error.message);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="mb-2 rounded-md border border-grid-line bg-grid-head/40 px-2 py-1.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-slate-600">Email:</span>
        {stats ? (
          <>
            <span className={stats.sent_today >= stats.daily_limit ? "font-medium text-red-700" : "text-slate-700"}>
              Emails today: {stats.sent_today} / {stats.daily_limit}
              {stats.queued > 0 ? ` (${stats.queued} waiting to send)` : ""}
            </span>
            <span className="text-slate-700">
              Pending in batches: {stats.pending_bugs} bug{stats.pending_bugs === 1 ? "" : "s"} for{" "}
              {stats.pending_people} {stats.pending_people === 1 ? "person" : "people"}
              {stats.project_pending_bugs > 0 ? ` (${stats.project_pending_bugs} in this project)` : ""}
            </span>
          </>
        ) : (
          <span className="text-slate-400">counters unavailable</span>
        )}
        <span className="text-slate-700">
          Mode: <span className="font-medium">{MODE_LABELS[current.mode]}</span>{" "}
          <span className="text-slate-500">({summary}; critical bugs always go at once)</span>
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setForm(current);
              setEditing(true);
            }}
            className="text-brand-fg hover:underline"
          >
            Change
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-grid-line pt-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-slate-500">Mode</span>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as Mode })}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {form.mode === "auto_batch" && (
            <>
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-500">Bugs per email</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.batch_size}
                  onChange={(e) => setForm({ ...form, batch_size: Number(e.target.value) })}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-500">Send anyway after (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={form.fallback_hours}
                  onChange={(e) => setForm({ ...form, fallback_hours: Number(e.target.value) })}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1"
                />
              </label>
            </>
          )}
          {form.mode === "daily_digest" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-500">Send at (Pakistan time)</span>
              <input
                type="time"
                value={form.digest_time}
                onChange={(e) => setForm({ ...form, digest_time: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-2 py-1"
              />
            </label>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
          {err && <span className="text-xs text-red-700">{err}</span>}
        </div>
      )}
    </div>
  );
}
