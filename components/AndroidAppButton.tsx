"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/**
 * "Install Android app": links to /download, which serves the signed APK
 * (android-app/, a Trusted Web Activity of this site, package com.catalystit.portal).
 *
 * Hidden only inside that app, or once it is installed. Chrome's own installed
 * copy of the site also runs full screen, so "standalone" can't tell the two apart:
 * - The APK launches the site with the referrer android-app://com.catalystit.portal.
 *   This is remembered for that session (sessionStorage), since later pages have
 *   ordinary referrers.
 * - Chrome reports the installed APK through getInstalledRelatedApps(). The manifest
 *   lists it in related_applications, and the APK's asset links point back at this site.
 *
 * - "header": phones only (Android), a compact button in the top bar.
 * - "sidebar": any device, a full-width button above "Sign out".
 * - "link": a text link (login page).
 */
const APP_ID = "com.catalystit.portal";

export function useAppContext() {
  const [ctx, setCtx] = useState({ ready: false, android: false, inApp: false, installed: false });
  useEffect(() => {
    let inApp = false;
    try {
      if (document.referrer.startsWith(`android-app://${APP_ID}`)) sessionStorage.setItem("catalyst-apk", "1");
      inApp = sessionStorage.getItem("catalyst-apk") === "1";
    } catch {
      inApp = document.referrer.startsWith(`android-app://${APP_ID}`);
    }
    const android = /Android/i.test(navigator.userAgent);
    setCtx({ ready: true, android, inApp, installed: false });
    const nav = navigator as unknown as { getInstalledRelatedApps?: () => Promise<{ id?: string }[]> };
    nav.getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.some((a) => a.id === APP_ID)) setCtx((c) => ({ ...c, installed: true }));
      })
      .catch(() => {});
  }, []);
  return ctx;
}

const PHONE_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
    <rect x="4" y="1.5" width="8" height="13" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 12.3h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export default function AndroidAppButton({ variant }: { variant: "header" | "sidebar" | "link" }) {
  const { ready, android, inApp, installed } = useAppContext();
  if (!ready || inApp || installed) return null;
  if (variant === "header" && !android) return null;

  if (variant === "link") {
    return (
      <Link href="/download" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-fg hover:underline">
        {PHONE_ICON}
        Get the Android app
      </Link>
    );
  }
  return (
    <Link
      href="/download"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border border-brand-line bg-brand-soft font-medium text-brand-fg transition active:scale-95 hover:bg-brand-soft/70",
        variant === "header" ? "px-2.5 py-1.5 text-[12px]" : "mt-2 w-full px-2 py-1.5 text-xs",
      )}
    >
      {PHONE_ICON}
      {variant === "header" ? "Get app" : "Install Android app"}
    </Link>
  );
}
