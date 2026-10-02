import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { emailNotConfigured, sendEmail } from "@/lib/email-server";
import { renderEmail, type EmailItem, type EmailKind } from "@/lib/email-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends what is queued in `email_outbox` (migration 0044). Pinged by the database after
 * every insert into the outbox and by the 5-minute sweep. The ping carries no data and the
 * route only sends emails already queued, within today's quota (`email_claim` enforces it),
 * so it needs no secret: calling it early just sends sooner.
 */
const CLAIM = 20;
// The ping waits 30 s; stop claiming well before that.
const BUDGET_MS = 20_000;
// Resend allows 2 requests a second by default; Gmail also throttles bursts.
const GAP_MS = 550;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST() {
  const notConfigured = emailNotConfigured();
  if (notConfigured) {
    // Leave everything queued until email is configured.
    return NextResponse.json({ sent: 0, reason: notConfigured });
  }

  const admin = serviceRoleClient();
  const started = Date.now();
  let sent = 0;
  let failed = 0;

  while (Date.now() - started < BUDGET_MS) {
    const { data: rows, error } = await admin.rpc("email_claim", { p_limit: CLAIM });
    if (error) return NextResponse.json({ sent, failed, error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      // RFC 2606: .invalid can never be delivered (the email tests use it).
      if (row.recipient_email.endsWith(".invalid")) {
        await admin.rpc("email_mark", {
          p_id: row.id,
          p_ok: false,
          p_error: "undeliverable test address",
          p_final: true,
        });
        failed++;
        continue;
      }
      const items = (Array.isArray(row.items) ? row.items : []) as unknown as EmailItem[];
      if (items.length === 0) {
        await admin.rpc("email_mark", { p_id: row.id, p_ok: false, p_error: "no bugs listed", p_final: true });
        failed++;
        continue;
      }
      const { subject, text, html } = renderEmail(row.kind as EmailKind, items);
      const res = await sendEmail([row.recipient_email], subject, text, html);
      await admin.rpc("email_mark", { p_id: row.id, p_ok: res.sent, p_error: res.reason ?? null });
      if (res.sent) sent++;
      else failed++;
      await sleep(GAP_MS);
    }
    if (rows.length < CLAIM) break;
  }

  return NextResponse.json({ sent, failed });
}
