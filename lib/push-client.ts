import { createClient } from "@/lib/supabase/client";

/** Web Push (VAPID) subscribe / unsubscribe helpers for the browser. */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  // PwaManager registers /sw.js; wait for it to take control.
  return navigator.serviceWorker.ready;
}

/** Current permission + whether this browser already has an active subscription. */
export async function pushStatus(): Promise<{
  permission: NotificationPermission;
  subscribed: boolean;
}> {
  if (!pushSupported()) return { permission: "denied", subscribed: false };
  let subscribed = false;
  try {
    const reg = await readyRegistration();
    subscribed = !!(await reg.pushManager.getSubscription());
  } catch {
    /* ignore */
  }
  return { permission: Notification.permission, subscribed };
}

/**
 * Ask for permission, create a push subscription, and persist it to
 * `push_subscriptions` (RLS scopes it to the current user). Returns an
 * error message on failure, or null on success.
 */
export async function enablePush(userId: string): Promise<string | null> {
  if (!pushSupported()) return "This browser doesn't support push notifications.";
  if (!VAPID_PUBLIC_KEY) return "Push is not configured (missing VAPID key).";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied"
      ? "Notifications are blocked. Enable them in your browser's site settings."
      : "Notification permission was dismissed.";
  }

  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return "Could not read the push subscription from the browser.";
  }

  const supabase = createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 400),
    },
    { onConflict: "endpoint" },
  );
  if (error) return error.message;
  return null;
}

/** Remove this browser's subscription locally and from the database. */
export async function disablePush(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await readyRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      const supabase = createClient();
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint);
    }
  } catch (e) {
    return e instanceof Error ? e.message : "Could not disable push.";
  }
  return null;
}
