"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

/**
 * "Ask Grok to scan all groups" (migration 0051). POST /api/whatsapp/scan queues the request and
 * calls Grok's webhook routine so Grok starts at once; without a webhook (or when it fails) Grok's
 * next scheduled GET /api/intake/whatsapp picks it up. Grok scans every WhatsApp group since the
 * last scan and sends its rows through the usual intake. Shows the latest request's state and
 * re-reads it every 30 s while it is open. Hidden until 0051 exists.
 */
type Scan = {
  id: string;
  since: string;
  status: "pending" | "seen" | "done" | "cancelled" | "expired";
  requested_at: string;
  seen_at: string | null;
  completed_at: string | null;
  rows_received: number;
  note: string | null;
  notified_at: string | null;
  notify_error: string | null;
  requester: { full_name: string } | null;
};

const when = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export default function GrokScanButton({ onDone }: { onDone?: () => void }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [ready, setReady] = useState(false); // false = still loading, or 0051 not applied
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lastStatus = useRef<string | null>(null);

  const read = useCallback(async () => {
    const { data, error } = await createClient()
      .from("whatsapp_scan_requests")
      .select("id, since, status, requested_at, seen_at, completed_at, rows_received, note, notified_at, notify_error, requester:profiles!whatsapp_scan_requests_requested_by_fkey(full_name)")
      .order("requested_at", { ascending: false })
      .limit(1);
    if (error) return; // table missing: keep the button hidden
    const s = ((data ?? [])[0] ?? null) as unknown as Scan | null;
    if (s && lastStatus.current && lastStatus.current !== "done" && s.status === "done") onDone?.();
    lastStatus.current = s?.status ?? null;
    setScan(s);
    setReady(true);
  }, [onDone]);

  useEffect(() => {
    read();
  }, [read]);

  const open = scan?.status === "pending" || scan?.status === "seen";
  useEffect(() => {
    if (!open) return;
    const t = setInterval(read, 30_000);
    return () => clearInterval(t);
  }, [open, read]);

  async function ask() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/whatsapp/scan", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setErr(body.error ?? `Could not ask Grok (HTTP ${res.status}).`);
    } catch (e) {
      setErr(`Could not ask Grok: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
    await read();
  }

  async function cancel() {
    if (!scan) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("whatsapp_cancel_scan", { p_id: scan.id });
    setBusy(false);
    if (error) return setErr(error.message);
    await read();
  }

  if (!ready) return null;

  const by = scan?.requester?.full_name ? ` by ${scan.requester.full_name}` : "";
  const state = !scan
    ? null
    : scan.status === "pending"
      ? `Requested${by} at ${when(scan.requested_at)} (messages since ${when(scan.since)}). ${
          scan.notified_at
            ? `Grok was notified at ${when(scan.notified_at)}; waiting for it to start.`
            : scan.notify_error
              ? `Couldn't reach Grok (${scan.notify_error}); it will pick this up on its next scheduled check.`
              : "Waiting for Grok's next check."
        }`
      : scan.status === "seen"
        ? `Grok picked it up at ${when(scan.seen_at)} and is scanning all groups${scan.rows_received ? ` (${scan.rows_received} rows so far)` : ""}.`
        : scan.status === "done"
          ? `Last scan done at ${when(scan.completed_at)}: ${scan.rows_received} row${scan.rows_received === 1 ? "" : "s"} received.${scan.note ? ` Grok: ${scan.note}` : ""}`
          : scan.status === "expired"
            ? `The last request (${when(scan.requested_at)}) expired: Grok didn't pick it up within 24 hours.`
            : `The last request (${when(scan.requested_at)}) was cancelled.`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      {open ? (
        <>
          {scan?.status === "pending" && (
            <Button variant="secondary" onClick={ask} disabled={busy} title="Call Grok's webhook again">
              Nudge Grok
            </Button>
          )}
          <Button variant="secondary" onClick={cancel} disabled={busy}>
            Cancel scan request
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={ask} disabled={busy}>
          🔄 Ask Grok to scan all groups
        </Button>
      )}
      {state && <span className={open ? "text-violet-800" : "text-slate-500"}>{state}</span>}
      {err && <span className="text-red-700">{err}</span>}
    </div>
  );
}
