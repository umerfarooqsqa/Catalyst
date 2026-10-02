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
 * Auth: header `X-Api-Key: <key>` (or `Authorization: Bearer <key>`).
 * POST {"rows": [ {item_id, first_seen, last_seen, whatsapp_group, house, app_name, platform,
 *                  type, title, description, original_message, reporter, severity, category,
 *                  area, status, notes}, ... ]}   (or the array itself), at most 500 rows.
 *   -> {received, new, updated, already_imported, skipped, rejected: [{index, item_id?, reason}],
 *       auto_imported: {bugs, tasks, rows: [{item_id, action, project, reason}]},
 *       waiting_for_review}   (waiting_for_review = rows needing a project, for QA)
 * GET -> {ok, waiting_for_review, last_received_at}: a key check / status for Grok.
 */
const MAX_BYTES = 2 * 1024 * 1024;

function authorized(req: Request): NextResponse | null {
  const expected = process.env.WHATSAPP_INTAKE_KEY ?? "";
  if (!expected) return NextResponse.json({ error: "intake not configured" }, { status: 503 });
  const got =
    req.headers.get("x-api-key") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (!got || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = authorized(req);
  if (denied) return denied;
  const { data, error } = await serviceRoleClient().rpc("whatsapp_inbox_status");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

export async function POST(req: Request) {
  const denied = authorized(req);
  if (denied) return denied;

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "body over 2 MB" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  const rows = Array.isArray(body) ? body : (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'send {"rows": [...]} (or the array itself)' }, { status: 400 });
  }
  if (rows.length > 500) return NextResponse.json({ error: "at most 500 rows per request" }, { status: 400 });

  const admin = serviceRoleClient();
  const { data, error } = await admin.rpc("whatsapp_inbox_upsert", { p_rows: rows });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // File everything whose project is known; the rest waits for QA.
  const { data: auto, error: autoErr } = await admin.rpc("whatsapp_auto_import");
  const { data: status } = await admin.rpc("whatsapp_inbox_status");
  const received = data as Record<string, unknown>;
  const a = auto as { bugs?: number; tasks?: number; rows?: { item_id: string; action: string; project: string | null; reason: string | null }[] } | null;
  return NextResponse.json({
    ...received,
    auto_imported: autoErr
      ? { error: autoErr.message }
      : { bugs: a?.bugs ?? 0, tasks: a?.tasks ?? 0, rows: (a?.rows ?? []).filter((r) => r.reason !== "already imported") },
    waiting_for_review: (status as { waiting_for_review?: number } | null)?.waiting_for_review ?? received.waiting_for_review,
  });
}
