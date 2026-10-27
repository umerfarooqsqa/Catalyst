import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { receivePlayMails, MAX_PER_CALL, type PlayMail } from "@/lib/monitor/play-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Play Console emails (policy, Inbox, removal notices, deadlines), sent every 10 minutes by the
 * Google Apps Script an admin set up from Admin -> Google Play (migration 0056).
 * Header x-play-mail-key = private.settings play_mail_key.
 * Body {messages: [{id, thread_id, date, from, subject, body}]}, oldest first. Only the first
 * MAX_PER_CALL are taken (Cloudflare's per-run request limit); the answer's `accepted` says how
 * many, and the script sends the rest next. Each message is stored once; one naming apps becomes
 * a card on each; one naming none rings App health and waits on the admin page.
 */
export async function POST(req: Request) {
  const supabase = serviceRoleClient();
  const { data: expected } = await supabase.rpc("monitor_setting", { p_key: "play_mail_key" });
  const a = Buffer.from(req.headers.get("x-play-mail-key") ?? "");
  const b = Buffer.from(String(expected ?? ""));
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const messages: PlayMail[] = Array.isArray(body?.messages) ? body.messages.slice(0, MAX_PER_CALL) : [];
  try {
    return NextResponse.json(await receivePlayMails(messages));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
