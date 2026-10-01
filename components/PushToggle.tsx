"use client";

import { useCallback, useEffect, useState } from "react";
import { cx } from "@/components/ui";
import {
  pushSupported,
  pushStatus,
  enablePush,
  disablePush,
} from "@/lib/push-client";

/**
 * Enable / disable Web Push for this device. Lives on the Notifications
 * page. When on, the user gets notifications with sound + vibration even
 * when the app or browser is closed.
 */
export default function PushToggle({ userId }: { userId: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sync = useCallback(async () => {
    const s = await pushStatus();
    setSubscribed(s.subscribed);
    setPermission(s.permission);
  }, []);

  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);
    if (!ok) return;
    sync();

    // Service worker asks us to re-subscribe after the browser rotates keys.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "pushsubscriptionchange") {
        enablePush(userId).finally(sync);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [userId, sync]);

  async function toggle() {
    setBusy(true);
    setMsg(null);
    const err = subscribed ? await disablePush() : await enablePush(userId);
    if (err) setMsg(err);
    else if (!subscribed) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("Catalyst", {
          body: "Notifications are on for this device.",
          tag: "catalyst-enabled",
          icon: "/icons/icon-192.png",
          vibrate: [120, 60, 120],
        } as NotificationOptions & { vibrate: number[] });
      } catch {
        /* ignore */
      }
    }
    await sync();
    setBusy(false);
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(json.error || "Test failed.");
    } catch {
      setMsg("Test request failed.");
    }
    setBusy(false);
  }

  if (supported === null) return null;

  if (!supported) {
    return (
      <div className="mb-4 rounded-lg border border-grid-line bg-white p-3 text-[13px] text-slate-500">
        Push notifications aren&apos;t supported in this browser. On iPhone,
        install the app to the Home Screen first (Share → Add to Home Screen).
      </div>
    );
  }

  const blocked = permission === "denied";

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-grid-line bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">
          Push notifications {subscribed && <span className="text-brand-fg">· on</span>}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {subscribed
            ? "This device gets alerts with sound and vibration, even when the app is closed."
            : blocked
              ? "Blocked. Allow notifications for this site in your browser settings, then turn on."
              : "Get alerts on this device (sound + vibration), even when the app is closed."}
        </p>
        {msg && <p className="mt-1 text-xs text-red-600">{msg}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {subscribed && (
          <button
            onClick={sendTest}
            disabled={busy}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition active:scale-95 hover:bg-grid-head disabled:opacity-50"
          >
            Send test
          </button>
        )}
        <button
          onClick={toggle}
          disabled={busy || (blocked && !subscribed)}
          className={cx(
            "rounded-md px-3 py-2 text-xs font-medium transition active:scale-95 disabled:opacity-50",
            subscribed
              ? "border border-slate-300 text-slate-700 hover:bg-grid-head"
              : "bg-brand text-white hover:bg-brand-fg",
          )}
        >
          {busy ? "…" : subscribed ? "Turn off" : "Turn on"}
        </button>
      </div>
    </div>
  );
}
