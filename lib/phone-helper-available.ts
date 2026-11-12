"use client";

import { useEffect, useState } from "react";
import { PHONE_HELPER_URL } from "@/lib/phone-screenshot";

/**
 * The phone tools ("📱 Take phone screenshot", "📍 Capture where it happens") talk to the aktrade
 * Control Center on the tester's PC (localhost:217).
 *
 * Changed 2026-10-07: the buttons used to be shown only when a 1.5 s probe of localhost answered
 * at page load. That hid them whenever the Control Center was starting, adb was slow, or Chrome
 * was still asking its "access devices on your local network" question, so they kept "vanishing".
 * Now the bug drawer shows them on every computer (useDesktop) and a click explains what's wrong.
 * The probe (5 s, a failure is not cached) only decides the new-bug "📍 Attach where this happens"
 * checkbox, which runs by itself after saving.
 */
let cached: Promise<boolean> | null = null;

export function isPhoneHelperAvailable(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(`${PHONE_HELPER_URL}/adb/devices`, { cache: "no-store", signal: ctrl.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
    // A "no" isn't remembered: the next dialog asks again (the Control Center may have started since).
    cached.then((ok) => {
      if (!ok) cached = null;
    });
  }
  return cached;
}

/** null while checking, then true/false. */
export function usePhoneHelper(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    isPhoneHelperAvailable().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

/**
 * A computer (mouse/trackpad, not Android): where the phone tools can work at all. False in the
 * catalyst Android app and on phones, where there is no Control Center.
 */
export function useDesktop(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(!/Android|iPhone|iPad/i.test(navigator.userAgent) && window.matchMedia("(pointer: fine)").matches);
  }, []);
  return ok;
}
