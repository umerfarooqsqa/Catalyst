import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { isManager } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { serviceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Ask Grok to scan all groups" (migration 0051). QA/admin session only.
 *
 * 1. Queues the request (whatsapp_request_scan, as the signed-in user; an open request is reused).
 * 2. Calls Grok's webhook routine so Grok starts now: POST GROK_WEBHOOK_URL with the secret in the
 *    header GROK_WEBHOOK_HEADER (default X-Webhook-Secret) and the JSON body below. It isn't called
 *    again for a request Grok was notified about in the last 10 minutes.
 * 3. Records the outcome (whatsapp_scan_notified). Without a webhook, or when it fails, Grok's next
 *    scheduled GET /api/intake/whatsapp still returns the request.
 *
 * Body sent to Grok:
 *   {action: "scan_whatsapp", scope: "all_groups", scan_request_id, since, requested_by,
 *    requested_at, report_to: "<portal>/api/intake/whatsapp", instructions}
 * Grok answers by POSTing its rows to report_to with scan_request_id (see that route).
 */
const RENOTIFY_AFTER_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const { level, profile } = await requireProfile();
  if (!isManager(level)) {
    return NextResponse.json({ error: "Only QA or an admin can ask Grok to scan." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: scan, error } = await supabase.rpc("whatsapp_request_scan");
  if (error || !scan) {
    return NextResponse.json({ error: error?.message ?? "Could not queue the scan request." }, { status: 400 });
  }

  const url = process.env.GROK_WEBHOOK_URL?.trim();
  if (!url) {
    return NextResponse.json({ scan, webhook: { sent: false, reason: "no webhook configured (GROK_WEBHOOK_URL)" } });
  }
  if (scan.notified_at && Date.now() - new Date(scan.notified_at).getTime() < RENOTIFY_AFTER_MS) {
    return NextResponse.json({ scan, webhook: { sent: false, reason: "Grok was notified less than 10 minutes ago" } });
  }

  const reportTo = new URL("/api/intake/whatsapp", req.url).toString();
  const since = new Date(scan.since);
  const body = {
    action: "scan_whatsapp",
    scope: "all_groups",
    scan_request_id: scan.id,
    since: since.toISOString(),
    requested_by: profile.full_name ?? null,
    requested_at: scan.requested_at,
    report_to: reportTo,
    instructions:
      `Scan ALL WhatsApp groups for messages since ${since.toISOString()}, update the "Catalyst import" sheet, ` +
      `then POST the whole sheet to ${reportTo} (header X-Api-Key) with "scan_request_id": "${scan.id}" and ` +
      `"scan_done": true (batches of up to 500 rows: "scan_done": false until the last). Nothing new: POST ` +
      `{"rows": [], "scan_request_id": "${scan.id}", "scan_done": true}. One row per house.`,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.GROK_WEBHOOK_SECRET?.trim();
  if (secret) headers[process.env.GROK_WEBHOOK_HEADER?.trim() || "X-Webhook-Secret"] = secret;

  let failure: string | null = null;
  let status: number | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (!res.ok) failure = `Grok's webhook answered HTTP ${res.status}`;
  } catch (e) {
    failure = `Grok's webhook could not be reached: ${e instanceof Error ? e.message : String(e)}`;
  }

  const admin = serviceRoleClient();
  await admin.rpc("whatsapp_scan_notified", { p_id: scan.id, p_error: failure });
  const { data: fresh } = await admin.from("whatsapp_scan_requests").select("*").eq("id", scan.id).single();
  return NextResponse.json({ scan: fresh ?? scan, webhook: { sent: !failure, status, error: failure } });
}
