"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (once, app-wide). Rendered from the root
 * layout so it runs on every route including /login. Renders nothing.
 *
 * The install prompt lives in {@link InstallButton} and push subscription
 * in {@link PushToggle}; this only gets the worker in place.
 */
export default function PwaManager() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[pwa] SW registration failed:", err));
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
