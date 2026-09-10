import type { NextConfig } from "next";
import path from "node:path";

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "*.supabase.co";
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
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} https://generativelanguage.googleapis.com`,
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
  // pdf-parse / mammoth are Node-only; keep them out of the bundle.
  serverExternalPackages: ["pdf-parse", "mammoth"],
  eslint: {
    // Lint is run separately; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
