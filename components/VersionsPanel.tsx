"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addAppVersion } from "@/app/(app)/projects/actions";
import { Badge, Button, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { titleCase } from "@/lib/format";
import { isManager } from "@/lib/permissions";
import type { BugWithJoins, ReleaseOption, RoleLevel } from "@/lib/types/models";

/**
 * "App versions" on the Bugs page (migration 0037).
 * - Everyone sees the app's versions, which one is current, and how many bugs each has
 *   and how many of those QA has confirmed. Clicking a version filters the board.
 * - QA/admin add versions ("+ Add version", optionally making it current), and after
 *   writing a version's bugs, confirm that they belong to it ("Review & confirm").
 *   The confirmation is per bug; changing a bug's version clears it (DB trigger).
 */
export default function VersionsPanel({
  projectId,
  bugs,
  releases,
  currentVersion,
  role,
  activeFilter,
  onFilter,
  onChanged,
}: {
  projectId: string;
  bugs: BugWithJoins[];
  releases: ReleaseOption[];
  currentVersion: string | null;
  role: RoleLevel;
  activeFilter: string;
  onFilter: (releaseId: string) => void;
  onChanged: () => void;
}) {
  const manager = isManager(role);
  const [adding, setAdding] = useState(false);
  const [newVersion, setNewVersion] = useState("");
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ReleaseOption | null>(null);

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; confirmed: number; open: number }>();
    for (const b of bugs) {
      const key = b.release_id ?? "none";
      const s = m.get(key) ?? { total: 0, confirmed: 0, open: 0 };
      s.total += 1;
      if (b.release_id && b.version_confirmed_at) s.confirmed += 1;
      if (b.status !== "closed") s.open += 1;
      m.set(key, s);
    }
    return m;
  }, [bugs]);
  const noVersion = stats.get("none")?.total ?? 0;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newVersion.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await addAppVersion(projectId, newVersion, makeCurrent);
    setBusy(false);
    if (res.error) return setErr(res.error);
    setMsg(
      `${res.existed ? "Version already existed" : "Added"}: v${res.version}${makeCurrent ? ", now the current version (new bugs default to it)" : ""}.`,
    );
    setNewVersion("");
    setAdding(false);
    onChanged();
  }

  return (
    <div className="mb-2 rounded-md border border-grid-line bg-white px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-600">App versions:</span>
        {releases.length === 0 && <span className="text-slate-400">none yet</span>}
        {releases.map((r) => {
          const s = stats.get(r.id) ?? { total: 0, confirmed: 0, open: 0 };
          const unconfirmed = s.total - s.confirmed;
          return (
            <span
              key={r.id}
              className={cx(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
                activeFilter === r.id ? "border-brand bg-brand-soft" : "border-slate-200",
              )}
            >
              <button
                onClick={() => onFilter(activeFilter === r.id ? "" : r.id)}
                className="font-medium text-slate-800 hover:underline"
                title={activeFilter === r.id ? "Show every version" : `Show only v${r.version}'s bugs`}
              >
                v{r.version}
              </button>
              {r.version === currentVersion && <Badge tone="blue">current</Badge>}
              <span className="text-xs text-slate-500">
                {s.total} bug{s.total === 1 ? "" : "s"}
                {s.total > 0 && (
                  <>
                    {" · "}
                    <span className={unconfirmed ? "text-amber-700" : "text-brand-fg"}>
                      {unconfirmed ? `${s.confirmed}/${s.total} confirmed` : "all confirmed ✓"}
                    </span>
                  </>
                )}
              </span>
              {manager && unconfirmed > 0 && (
                <button
                  onClick={() => setReviewing(r)}
                  className="rounded bg-brand/10 px-1.5 text-xs font-medium text-brand-fg hover:bg-brand/20"
                >
                  Review &amp; confirm
                </button>
              )}
            </span>
          );
        })}
        {noVersion > 0 && (
          <button
            onClick={() => onFilter(activeFilter === "none" ? "" : "none")}
            className={cx(
              "rounded-md border px-1.5 py-0.5 text-xs text-amber-800",
              activeFilter === "none" ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-amber-50",
            )}
            title="Bugs with no app version: open one to set its version"
          >
            {noVersion} with no version
          </button>
        )}
        {manager && !adding && (
          <button onClick={() => setAdding(true)} className="text-xs font-medium text-brand hover:underline">
            + Add version
          </button>
        )}
      </div>

      {manager && adding && (
        <form onSubmit={add} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={newVersion}
            onChange={(e) => setNewVersion(e.target.value)}
            placeholder="e.g. 1.0.8"
            className="w-28 rounded-md border border-slate-300 px-2 py-1"
          />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={makeCurrent} onChange={(e) => setMakeCurrent(e.target.checked)} />
            make it the current version
          </label>
          <Button type="submit" disabled={busy || !newVersion.trim()}>
            {busy ? "Adding…" : "Add"}
          </Button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:underline">
            cancel
          </button>
          {makeCurrent && (
            <span className="text-xs text-slate-400">
              Automation runs for a new current version wait until its release notes are added.
            </span>
          )}
        </form>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {msg && <p className="mt-1 text-xs text-brand-fg">{msg}</p>}

      {reviewing && (
        <ConfirmDialog
          release={reviewing}
          bugs={bugs.filter((b) => b.release_id === reviewing.id)}
          onClose={() => setReviewing(null)}
          onDone={(n) => {
            setReviewing(null);
            setMsg(`Confirmed ${n} bug${n === 1 ? "" : "s"} for v${reviewing.version}.`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  release,
  bugs,
  onClose,
  onDone,
}: {
  release: ReleaseOption;
  bugs: BugWithJoins[];
  onClose: () => void;
  onDone: (confirmed: number) => void;
}) {
  const pending = bugs.filter((b) => !b.version_confirmed_at);
  const confirmedCount = bugs.length - pending.length;
  const [picked, setPicked] = useState<Set<string>>(new Set(pending.map((b) => b.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function confirm() {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(true);
    setErr(null);
    // The DB trigger stamps the time and who confirmed; release_id guards against a bug moved meanwhile.
    const { data, error } = await createClient()
      .from("bugs")
      .update({ version_confirmed_at: new Date().toISOString() })
      .in("id", ids)
      .eq("release_id", release.id)
      .select("id");
    setBusy(false);
    if (error) return setErr(error.message);
    onDone(data?.length ?? 0);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center overflow-y-auto bg-slate-900/40 sm:items-start sm:p-8"
      onClick={onClose}
    >
      <div
        className="flex min-h-full w-full max-w-2xl flex-col bg-white shadow-xl sm:min-h-0 sm:rounded-sm sm:border sm:border-grid-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-grid-line bg-white px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-slate-800">Confirm bugs for v{release.version}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:max-h-[70vh] sm:p-5">
          <p className="text-sm text-slate-600">
            Tick the bugs that really were found in <b>v{release.version}</b> of this app, then confirm. Untick any
            that belong to another version and change their version in the bug itself. Developers see the confirmed
            version on every bug.
            {confirmedCount > 0 && ` ${confirmedCount} already confirmed.`}
          </p>
          <div className="flex gap-3 text-xs">
            <button onClick={() => setPicked(new Set(pending.map((b) => b.id)))} className="text-brand hover:underline">
              tick all
            </button>
            <button onClick={() => setPicked(new Set())} className="text-slate-500 hover:underline">
              untick all
            </button>
          </div>
          <ul className="divide-y divide-grid-line rounded-md border border-grid-line">
            {pending.map((b) => (
              <li key={b.id}>
                <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-grid-head/40">
                  <input type="checkbox" className="mt-1" checked={picked.has(b.id)} onChange={() => toggle(b.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{b.title}</span>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      <Badge tone={b.severity === "critical" ? "red" : b.severity === "major" ? "amber" : "slate"}>
                        {SEVERITY_LABELS[b.severity]}
                      </Badge>
                      <Badge tone="blue">{titleCase(b.status)}</Badge>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-grid-line px-4 py-3 sm:px-5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || picked.size === 0}>
            {busy ? "Confirming…" : `Confirm ${picked.size} bug${picked.size === 1 ? "" : "s"} belong to v${release.version}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
