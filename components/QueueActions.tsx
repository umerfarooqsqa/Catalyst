"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isAdmin } from "@/lib/permissions";
import type { RoleLevel } from "@/lib/types/models";

const btn =
  "rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const primary =
  "rounded-md bg-brand px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-fg disabled:opacity-50";

/**
 * My Queue buttons for a bug assigned to you. Allowed for a developer, and so
 * shown for everyone who works the queue: open/reopened → In progress or Fixed,
 * in progress → Fixed. QA closes it after retest (migration 0034 enforces this
 * for developers).
 */
export function BugQueueActions({ bugId, status }: { bugId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const targets =
    status === "open" || status === "reopened" ? ["in_progress", "fixed"] : status === "in_progress" ? ["fixed"] : [];

  async function set(next: string) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("bugs").update({ status: next as never }).eq("id", bugId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  if (!targets.length) return <span className="text-xs text-slate-400">{status === "fixed" ? "waiting for QA" : ""}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {targets.includes("in_progress") && (
        <button className={btn} disabled={busy} onClick={() => set("in_progress")}>
          Start
        </button>
      )}
      <button className={primary} disabled={busy} onClick={() => set("fixed")}>
        Mark fixed
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}

/**
 * My Queue buttons for a task assigned to you. "Mark done" sends it for approval:
 * only an admin can move a task to Done (migration 0017). An admin's own
 * tasks go straight to Done.
 */
export function TaskQueueActions({ taskId, status, role }: { taskId: string; status: string; role: RoleLevel }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: string) {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("tasks").update({ status: next as never }).eq("id", taskId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  if (status === "pending_approval") return <span className="text-xs text-slate-400">waiting for approval</span>;
  if (status === "done") return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status === "todo" && (
        <button className={btn} disabled={busy} onClick={() => set("in_progress")}>
          Start
        </button>
      )}
      <button className={primary} disabled={busy} onClick={() => set(isAdmin(role) ? "done" : "pending_approval")}>
        {isAdmin(role) ? "Mark done" : "Mark done → approval"}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}

export type JuniorOption = { id: string; full_name: string };

/**
 * A lead developer's hand-on picker (migration 0040): give a bug or task that is
 * assigned to them to a junior developer who can see the project, move it to
 * another junior, or take it back. The database sets `delegated_by` and refuses
 * anything else, so this only sends the new assignee.
 */
export function DelegateSelect({
  table,
  id,
  juniors,
  selfId,
  assigneeId,
}: {
  table: "bugs" | "tasks";
  id: string;
  juniors: JuniorOption[];
  selfId: string;
  assigneeId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handedOn = assigneeId !== selfId;
  const others = juniors.filter((j) => j.id !== assigneeId);

  async function assign(next: string) {
    if (!next) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from(table).update({ assignee_id: next }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  if (!handedOn && !others.length)
    return <span className="text-xs text-slate-400">no junior developer on this platform</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-50"
        value=""
        disabled={busy}
        aria-label={handedOn ? "Reassign or take back" : "Hand to a junior developer"}
        onChange={(e) => assign(e.target.value)}
      >
        <option value="">{handedOn ? "Reassign…" : "Hand to junior…"}</option>
        {others.map((j) => (
          <option key={j.id} value={j.id}>
            {j.full_name}
          </option>
        ))}
        {handedOn && <option value={selfId}>↩ Take it back</option>}
      </select>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}

/**
 * An admin's check of a bug a developer marked fixed (My Queue, "waiting for you to
 * verify"): Close when the fix holds, Reopen when it doesn't. Admins are exempt from the
 * developer-rights trigger (0034), so both are plain status updates.
 */
export function VerifyFixActions({ bugId }: { bugId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: "closed" | "reopened") {
    setBusy(true);
    setErr(null);
    const { error } = await createClient().from("bugs").update({ status: next }).eq("id", bugId);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button className={primary} disabled={busy} onClick={() => set("closed")}>
        Close: fix verified
      </button>
      <button className={btn} disabled={busy} onClick={() => set("reopened")}>
        Reopen
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
