import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serviceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grok's WhatsApp rows (migration 0047). The key (WHATSAPP_INTAKE_KEY) puts rows in the inbox;
 * then every bug/task row whose project is known is filed at once (whatsapp_auto_import, 0048,
 * decided with the user 2026-10-02). Rows that would need a new project, match several projects,
 * or name no app wait for QA on /import/whatsapp. The key can't create projects or change data.
 *
 * Auth: header `X-Api-Key: <key>` (or `Authorization: Bearer <key>`): WHATSAPP_INTAKE_KEY (the
 * WhatsApp Bot) or WHATSAPP_INTAKE_KEY_TRACKER (the Google Sheet tracker assistant, 0052). Answers
 * carry `sender`. Only the WhatsApp Bot's GET returns scan_request.
 * POST {"rows": [ {item_id, first_seen, last_seen, whatsapp_group, house, app_name, platform,
 *                  type, title, description, original_message, reporter, severity, category,
 *                  area, status, notes}, ... ]}   (or the array itself), at most 500 rows.
 *   -> {received, new, updated, already_imported, skipped, rejected: [{index, item_id?, reason}],
 *       auto_imported: {bugs, tasks, rows: [{item_id, action, project, reason}]},
 *       waiting_for_review}   (waiting_for_review = rows needing a project, for QA)
 * GET -> {ok, waiting_for_review, last_received_at, scan_request}: a key check / status for Grok.
 *
 * Scan requests (migration 0051): QA's "Ask Grok to scan all groups" queues one. GET returns it as
 * scan_request {id, scope, since, requested_at, requested_by, instructions} (null when none) and
 * marks it seen. Grok then scans every group since `since` and POSTs the sheet with
 *   "scan_request_id": "<id>", "scan_done": true (false on all but the last batch), "note": "..."
 * An empty "rows": [] with scan_done is fine ("nothing new"). The POST answer adds
 * scan_request: {id, status, rows_received} (or ignored + reason).
 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Senders, each with its own key (migration 0052), so either can be switched off (unset its
 * variable and redeploy) without the other: the WhatsApp Bot, and the assistant that keeps the
 * Google Sheet tracker. whatsapp_inbox.sender records which one last sent each row.
 */
const SENDERS = [
  { sender: "whatsapp_bot", env: "WHATSAPP_INTAKE_KEY" },
  { sender: "tracker", env: "WHATSAPP_INTAKE_KEY_TRACKER" },
] as const;
type Sender = (typeof SENDERS)[number]["sender"];

function authorized(req: Request): { sender: Sender } | NextResponse {
  const keys = SENDERS.map((s) => ({ ...s, key: process.env[s.env]?.trim() ?? "" })).filter((s) => s.key);
  if (!keys.length) return NextResponse.json({ error: "intake not configured" }, { status: 503 });
  const got =
    req.headers.get("x-api-key") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const match = got
    ? keys.find((s) => {
        const b = Buffer.from(s.key);
        return a.length === b.length && timingSafeEqual(a, b);
      })
    : undefined;
  if (!match) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return { sender: match.sender };
}

export async function GET(req: Request) {
  const auth = authorized(req);
  if (auth instanceof NextResponse) return auth;
  const admin = serviceRoleClient();
  const [{ data, error }, scan] = await Promise.all([
    admin.rpc("whatsapp_inbox_status"),
    // Only the WhatsApp Bot scans groups; a tracker GET must not mark a request as picked up.
    auth.sender === "whatsapp_bot" ? admin.rpc("whatsapp_scan_pending") : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    sender: auth.sender,
    ...(data as Record<string, unknown>),
    scan_request: scan.error ? null : (scan.data ?? null),
  });
}

export async function POST(req: Request) {
  const auth = authorized(req);
  if (auth instanceof NextResponse) return auth;

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "body over 2 MB" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  const meta = (Array.isArray(body) ? {} : (body ?? {})) as {
    rows?: unknown;
    scan_request_id?: unknown;
    scan_done?: unknown;
    note?: unknown;
  };
  const rows = Array.isArray(body) ? body : meta.rows;
  const scanId = typeof meta.scan_request_id === "string" ? meta.scan_request_id.trim() : "";
  if (scanId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanId)) {
    return NextResponse.json({ error: "scan_request_id is not a valid id" }, { status: 400 });
  }
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'send {"rows": [...]} (or the array itself)' }, { status: 400 });
  }
  if (rows.length > 500) return NextResponse.json({ error: "at most 500 rows per request" }, { status: 400 });

  const admin = serviceRoleClient();
  const { data, error } = await admin.rpc("whatsapp_inbox_upsert", { p_rows: rows });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Who sent these rows (0052); best effort, never fails the request.
  const ids = rows
    .map((r) => (r && typeof r === "object" ? String((r as { item_id?: unknown }).item_id ?? "").trim() : ""))
    .filter(Boolean);
  if (ids.length) await admin.rpc("whatsapp_inbox_set_sender", { p_item_ids: ids, p_sender: auth.sender });

  // File everything whose project is known; the rest waits for QA.
  const { data: auto, error: autoErr } = await admin.rpc("whatsapp_auto_import");
  const { data: status } = await admin.rpc("whatsapp_inbox_status");
  // Rows sent for a scan request (0051): count them; the last batch completes the request.
  let scanRequest: unknown;
  if (scanId) {
    const { data: rep, error: repErr } = await admin.rpc("whatsapp_scan_report", {
      p_id: scanId,
      p_rows: rows.length,
      p_note: typeof meta.note === "string" ? meta.note : null,
      p_done: meta.scan_done === undefined ? true : meta.scan_done !== false,
    });
    scanRequest = repErr ? { id: scanId, error: repErr.message } : rep;
  }
  const received = data as Record<string, unknown>;
  const a = auto as { bugs?: number; tasks?: number; rows?: { item_id: string; action: string; project: string | null; reason: string | null }[] } | null;
  return NextResponse.json({
    sender: auth.sender,
    ...received,
    auto_imported: autoErr
      ? { error: autoErr.message }
      : { bugs: a?.bugs ?? 0, tasks: a?.tasks ?? 0, rows: (a?.rows ?? []).filter((r) => r.reason !== "already imported") },
    waiting_for_review: (status as { waiting_for_review?: number } | null)?.waiting_for_review ?? received.waiting_for_review,
    ...(scanId ? { scan_request: scanRequest } : {}),
  });
}
