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

/** Saves a subscription for whoever is signed in (/api/push/subscribe moves it between accounts). */
async function saveSubscription(sub: PushSubscription): Promise<string | null> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return "Could not read the push subscription from the browser.";
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 400),
    }),
  }).catch(() => null);
  if (!res?.ok) return (await res?.json().catch(() => null))?.error ?? "Could not save this device's subscription.";
  return null;
}

/**
 * Current permission + whether this device gets pushes for the signed-in user: the browser has a
 * subscription AND it is saved for this user (before, only the browser was asked, so the toggle
 * said "on" for a subscription the server didn't have).
 */
export async function pushStatus(): Promise<{
  permission: NotificationPermission;
  subscribed: boolean;
}> {
  if (!pushSupported()) return { permission: "denied", subscribed: false };
  let subscribed = false;
  try {
    const reg = await readyRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`);
      subscribed = !!(await res.json().catch(() => null))?.mine;
    }
  } catch {
    /* ignore */
  }
  return { permission: Notification.permission, subscribed };
}

/**
 * Re-saves this device's subscription for the signed-in user, silently, when notifications are
 * already allowed (run on every app load): heals a subscription the browser renewed, a row that
 * was pruned, or a shared browser after switching accounts. Never asks for permission.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted" || !VAPID_PUBLIC_KEY) return;
  try {
    const reg = await readyRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch {
    /* best effort */
  }
}

/** Forgets this device's subscription (sign-out), so it stops getting this person's pushes. */
export async function forgetPushOnThisDevice(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await Promise.race([
      readyRegistration(),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
  } catch {
    /* best effort: never block signing out */
  }
}

/**
 * Ask for permission, create a push subscription, and save it for the
 * signed-in user (/api/push/subscribe). Returns an error message on
 * failure, or null on success.
 */
export async function enablePush(): Promise<string | null> {
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

  return saveSubscription(sub);
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
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch (e) {
    return e instanceof Error ? e.message : "Could not disable push.";
  }
  return null;
}
