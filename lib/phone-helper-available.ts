"use client";

import { useEffect, useState } from "react";
import { PHONE_HELPER_URL } from "@/lib/phone-screenshot";

/**
 * Is the aktrade Control Center (the "phone helper" at PHONE_HELPER_URL,
 * localhost:217) running on this device? It exists only on the tester's PC,
 * never on a phone or in the Android app. So the buttons that need it ("📱 Take
 * phone screenshot", "📍 Capture where it happens" and the new-bug "📍 Attach
 * where this happens" checkbox) are shown only when it answers.
 *
 * It is asked once per page load (1.5 s timeout) and the answer is shared.
 */
let cached: Promise<boolean> | null = null;

export function isPhoneHelperAvailable(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      try {
        const res = await fetch(`${PHONE_HELPER_URL}/adb/devices`, { cache: "no-store", signal: ctrl.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
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
