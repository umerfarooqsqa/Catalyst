"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";

type Kind = Database["public"]["Tables"]["email_opt_outs"]["Row"]["event_type"];

const KINDS: [Exclude<Kind, "all">, string][] = [
  ["assignment", "Assigned to me"],
  ["status_change", "Status changes"],
  ["comment", "Comments"],
  ["retest_ready", "Fixed / ready for retest"],
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Where my bug emails go (migration 0045) and which ones I get (0044). Emails go only to an
 * address added here or by an admin (logins are @catalyst.com, which nobody receives mail at).
 * Everyone with an address is emailed about what the bell tells them; a row in email_opt_outs
 * turns one kind, or all of them, off. Hidden until the migrations are applied.
 */
export default function EmailPrefs({ userId }: { userId: string }) {
  const [off, setOff] = useState<Set<Kind> | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data, error }, { data: addr, error: addrErr }] = await Promise.all([
      supabase.from("email_opt_outs").select("event_type").eq("user_id", userId),
      supabase.from("notification_emails").select("email").eq("user_id", userId).maybeSingle(),
    ]);
    if (error || addrErr) return setOff(null);
    setOff(new Set((data ?? []).map((r) => r.event_type)));
    setAddress(addr?.email ?? null);
    setDraft(addr?.email ?? "");
  }, [userId]);

  async function saveAddress(remove = false) {
    setErr(null);
    setSaved(false);
    const email = remove ? "" : draft.trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return setErr(`"${email}" is not an email address.`);
    setBusy(true);
    const supabase = createClient();
    const { error } = email
      ? await supabase.from("notification_emails").upsert({ user_id: userId, email })
      : await supabase.from("notification_emails").delete().eq("user_id", userId);
    setBusy(false);
    if (error) return setErr(error.message);
    setSaved(true);
    load();
  }

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(kind: Kind, wantEmails: boolean) {
    setErr(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = wantEmails
      ? await supabase.from("email_opt_outs").delete().eq("user_id", userId).eq("event_type", kind)
      : await supabase.from("email_opt_outs").insert({ user_id: userId, event_type: kind });
    setBusy(false);
    if (error) setErr(error.message);
    load();
  }

  if (!off) return null;
  const allOff = off.has("all");

  return (
    <div className="mb-4 rounded-md border border-grid-line bg-white px-3 py-2 text-[13px]">
      <form
        className="mb-2 flex flex-wrap items-center gap-2 border-b border-grid-line pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveAddress();
        }}
      >
        <label htmlFor="notify-email" className="font-medium text-slate-700">
          Send my bug emails to
        </label>
        <input
          id="notify-email"
          type="email"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="you@gmail.com"
          className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().toLowerCase() === (address ?? "")}
          className="rounded-md bg-brand px-2.5 py-1 font-medium text-white hover:bg-brand-fg disabled:opacity-50"
        >
          Save
        </button>
        {address && (
          <button
            type="button"
            disabled={busy}
            onClick={() => saveAddress(true)}
            className="text-xs text-slate-500 hover:text-red-700 hover:underline"
          >
            Remove
          </button>
        )}
        {saved && <span className="text-xs text-green-700">Saved</span>}
        {!address && (
          <span className="basis-full text-xs text-amber-700">
            Add your Gmail to get bug emails. Until then you only get these notifications here.
          </span>
        )}
      </form>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
          <input type="checkbox" checked={!allOff} disabled={busy} onChange={(e) => toggle("all", e.target.checked)} />
          Email me about bugs
        </label>
        {KINDS.map(([kind, label]) => (
          <label key={kind} className="inline-flex items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={!allOff && !off.has(kind)}
              disabled={busy || allOff}
              onChange={(e) => toggle(kind, e.target.checked)}
            />
            {label}
          </label>
        ))}
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Each project sends at once, in batches or as a daily digest. Critical bugs are always emailed at once.
      </p>
    </div>
  );
}
