import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/** Server-side Web Push delivery (VAPID). */

type Admin = SupabaseClient<Database>;

export type PushPayload = {
  title: string;
  body: string;
  /** Path (or absolute URL) to open on click. */
  url: string;
  /** Notifications sharing a tag replace instead of stacking. */
  tag?: string;
  vibrate?: number[];
};

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/**
 * Send a push to every subscription the user has registered. Prunes
 * subscriptions the push service reports as gone (404/410). Returns a
 * summary; never throws for individual delivery failures.
 */
export async function sendPushToUser(
  admin: Admin,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; skipped?: string }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0, skipped: "not_configured" };

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.warn("[push] send failed:", code, (err as Error)?.message);
      }
    }),
  );

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", dead);
  }
  return { sent, pruned: dead.length };
}
