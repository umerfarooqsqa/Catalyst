"use client";

import { useEffect, useState } from "react";

/**
 * True while the viewport is below Tailwind's `lg` breakpoint (1024px).
 * Used to pick a touch-friendly default (card views, FABs) without
 * preventing the user from switching back to the dense desktop UI.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}
