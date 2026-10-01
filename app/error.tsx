"use client";

import { useEffect } from "react";

/**
 * Root-level error boundary. Catches errors thrown in `app/page.tsx` and any
 * route segment that doesn't have its own `error.tsx`. Rendered inside the
 * root layout's `<body>`, so — unlike `global-error.tsx` — it must not emit
 * its own `<html>`/`<body>`.
 *
 * Having this sibling to `global-error.tsx` also keeps the root segment's
 * client-reference graph populated, which avoids a Next 15.5 bundler bug
 * where `global-error` is dropped from the React Client Manifest.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        minHeight: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 18, color: "#0f172a", margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
          {error.digest ? `Reference: ${error.digest}` : "Please try again."}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            background: "#217346",
            color: "#fff",
            border: 0,
            borderRadius: 3,
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
