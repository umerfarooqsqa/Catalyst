"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          background: "#f8fafc",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, color: "#0f172a" }}>
            The app hit an unexpected error
          </h1>
          <p style={{ fontSize: 13, color: "#64748b" }}>
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
      </body>
    </html>
  );
}
