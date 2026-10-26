"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import {
  addPlayKeys,
  addTargetRule,
  assignPlayMail,
  deletePlayKey,
  deleteTargetRule,
  runChecksNow,
  saveMonitorConfig,
} from "@/app/(app)/admin/google-play/actions";

/** Admin -> Google Play controls (migration 0056). Every action re-renders the server page. */

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<{ error?: string } | void>, done?: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fn();
      if (res && "error" in res && res.error) setErr(res.error);
      else if (done) setMsg(done);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, err, run, setMsg, setErr };
}

const Note = ({ msg, err }: { msg: string | null; err: string | null }) =>
  err ? <p className="mt-2 text-xs text-red-600">{err}</p> : msg ? <p className="mt-2 text-xs text-green-700">{msg}</p> : null;

export function KeyUpload() {
  const a = useAction();
  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() })));
    await a.run(async () => {
      const res = await addPlayKeys(files);
      a.setMsg(res.added.length ? `Added or replaced: ${res.added.join(", ")}.` : null);
      if (res.errors.length) return { error: res.errors.join(" · ") };
    });
  }
  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
        <input
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          disabled={a.busy}
          onChange={(e) => onFiles(e.target.files)}
        />
        {a.busy ? "Uploading…" : "Upload key JSON files…"}
      </label>
      <p className="mt-1 text-xs text-slate-500">
        One service-account key per Play developer account. Stored encrypted in Supabase Vault and never shown again.
        Uploading a key for the same service account replaces it.
      </p>
      <Note msg={a.msg} err={a.err} />
    </div>
  );
}

export function DeleteKeyButton({ id, name }: { id: string; name: string }) {
  const a = useAction();
  return (
    <span>
      <button
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
        disabled={a.busy}
        onClick={() => confirm(`Remove key ${name}? Apps only it can read stop being checked.`) && a.run(() => deletePlayKey(id))}
      >
        Remove
      </button>
      <Note msg={null} err={a.err} />
    </span>
  );
}

export function MonitorSwitch({ enabled }: { enabled: boolean }) {
  const a = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={enabled ? "secondary" : "primary"}
        disabled={a.busy}
        onClick={() => a.run(() => saveMonitorConfig({ enabled: !enabled }), enabled ? "Monitoring is off." : "Monitoring is on.")}
      >
        {enabled ? "Turn monitoring off" : "Turn monitoring on"}
      </Button>
      <Button variant="secondary" disabled={a.busy || !enabled} onClick={() => a.run(runChecksNow, "Checks started: results appear within a few minutes.")}>
        Run checks now
      </Button>
      <Note msg={a.msg} err={a.err} />
    </div>
  );
}

type Config = Record<string, number | boolean>;
const FIELDS: { key: string; label: string; pct?: boolean }[] = [
  { key: "early_share", label: "Early warning (share of the limit)", pct: true },
  { key: "crash_limit", label: "Crash rate limit", pct: true },
  { key: "anr_limit", label: "ANR rate limit", pct: true },
  { key: "device_limit", label: "Per-phone-model limit", pct: true },
  { key: "wakelock_limit", label: "Stuck wake lock limit", pct: true },
  { key: "device_min_users", label: "Phone models with at least (users)" },
  { key: "new_crash_min_users", label: "New crash with at least (users)" },
  { key: "play_minutes", label: "Play check every (minutes)" },
  { key: "vitals_minutes", label: "Vitals check every (minutes)" },
  { key: "stale_minutes", label: "'Checks have stopped' after (minutes)" },
  { key: "target_warn_days", label: "Target API warning (days before)" },
];

export function ConfigForm({ config }: { config: Config }) {
  const a = useAction();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, f.pct ? String(+(Number(config[f.key]) * 100).toFixed(3)) : String(config[f.key])])),
  );
  function save() {
    const out: Config = {};
    for (const f of FIELDS) {
      const n = Number(vals[f.key]);
      if (!Number.isFinite(n) || n <= 0) return a.setErr(`${f.label}: enter a positive number.`);
      out[f.key] = f.pct ? n / 100 : Math.round(n);
    }
    a.run(() => saveMonitorConfig(out), "Saved. The next checks use these values.");
  }
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-slate-600">
            {f.label}
            {f.pct ? " (%)" : ""}
            <Input value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} className="mt-1" />
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Button disabled={a.busy} onClick={save}>
          Save thresholds
        </Button>
      </div>
      <Note msg={a.msg} err={a.err} />
    </div>
  );
}

export function RuleForm() {
  const a = useAction();
  const [appliesTo, setAppliesTo] = useState<"updates" | "existing">("updates");
  const [api, setApi] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Applies to
          <Select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as "updates" | "existing")} className="mt-1">
            <option value="updates">New apps and updates</option>
            <option value="existing">Existing apps</option>
          </Select>
        </label>
        <label className="text-xs text-slate-600">
          Minimum API
          <Input value={api} onChange={(e) => setApi(e.target.value)} placeholder="37" className="mt-1 w-20" />
        </label>
        <label className="text-xs text-slate-600">
          From
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
        </label>
        <label className="min-w-64 flex-1 text-xs text-slate-600">
          Google&apos;s wording (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" />
        </label>
        <Button
          disabled={a.busy || !api || !date}
          onClick={() => a.run(() => addTargetRule(appliesTo, Number(api), date, note), "Rule added; every app is re-checked.")}
        >
          Add rule
        </Button>
      </div>
      <Note msg={a.msg} err={a.err} />
    </div>
  );
}

export function DeleteRuleButton({ id }: { id: string }) {
  const a = useAction();
  return (
    <button className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={a.busy} onClick={() => a.run(() => deleteTargetRule(id))}>
      Remove
    </button>
  );
}

export function ScriptBox({ script }: { script: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre className="max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{script}</pre>
      <Button
        variant="secondary"
        className="mt-2"
        onClick={async () => {
          await navigator.clipboard.writeText(script);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy script"}
      </Button>
    </div>
  );
}

export function AssignMail({ mailId, projects }: { mailId: string; projects: { id: string; name: string }[] }) {
  const a = useAction();
  const [pick, setPick] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select value={pick} onChange={(e) => setPick(e.target.value)} className="py-0.5 text-xs">
        <option value="">Choose the app…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button variant="secondary" disabled={!pick || a.busy} onClick={() => a.run(() => assignPlayMail(mailId, pick))}>
        File
      </Button>
      {a.err ? <span className="text-xs text-red-600">{a.err}</span> : null}
    </span>
  );
}
