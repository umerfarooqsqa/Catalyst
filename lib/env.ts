/**
 * Fail fast on missing configuration. Called from `instrumentation.ts` at
 * server boot so a misconfigured deploy never serves a broken app.
 */
const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** Required only for the features that use them — warn, don't crash. */
const OPTIONAL = [
  "SUPABASE_SERVICE_ROLE_KEY", // user & role administration
  "GEMINI_API_KEY", // requirements-document extraction
] as const;

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them in .env.local (dev) or the container environment (prod).`,
    );
  }

  try {
    // eslint-disable-next-line no-new
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }

  const softMissing = OPTIONAL.filter((k) => !process.env[k]?.trim());
  if (softMissing.length) {
    console.warn(
      `[env] optional variable(s) not set: ${softMissing.join(", ")} — ` +
        `the features that depend on them will be disabled.`,
    );
  }
}
