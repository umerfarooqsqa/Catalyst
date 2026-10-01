import type { NextConfig } from "next";
import path from "node:path";

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "*.supabase.co";
  }
})();

// The aktrade Control Center on the tester's PC, for "Take phone screenshot" on a bug
// (lib/phone-screenshot.ts). Both spellings of localhost, since either may be configured.
const phoneHelper = (() => {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_PHONE_HELPER_URL || "http://localhost:217");
    const alt = u.hostname === "localhost" ? "127.0.0.1" : u.hostname === "127.0.0.1" ? "localhost" : null;
    return [u.origin, alt && `${u.protocol}//${alt}${u.port ? `:${u.port}` : ""}`].filter(Boolean).join(" ");
  } catch {
    return "http://localhost:217 http://127.0.0.1:217";
  }
})();

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Next.js injects small inline bootstrap scripts; 'unsafe-inline' is the
  // pragmatic choice for the App Router without a nonce middleware.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "manifest-src 'self'",
  "worker-src 'self'",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} ${phoneHelper}`,
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // Emit a self-contained server build for Docker / self-hosting.
  output: "standalone",
  // A stray package-lock.json in the user's home dir makes Next mis-infer
  // the workspace root; pin it to this project.
  outputFileTracingRoot: path.join(__dirname),
  // mammoth / web-push are Node-only; keep them out of the bundle. (PDFs use unpdf, which is
  // meant to be bundled -- it is the serverless PDF.js build that runs on Workers.)
  serverExternalPackages: ["mammoth", "web-push"],
  eslint: {
    // Lint is run separately; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must never be served stale, or clients get
        // stuck on an old push handler.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
