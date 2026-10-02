import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/health",
  "/api/push/dispatch", // Supabase webhook — authorized by its own shared secret
  "/api/email/dispatch", // Supabase ping (0044) — sends only what is already queued, within the quota
  "/api/intake/whatsapp", // Grok (0047) — its own key; can only add rows to the review inbox
  "/api/automation", // aktrade automation API — authorized by its own shared secret
  "/manifest.webmanifest",
  "/sw.js",
  "/.well-known",
  "/download", // the Android app page and its APK (/downloads/...): shared with people not signed in yet // Digital Asset Links for the Android app (android-app/): must never redirect to /login
];

/**
 * Refreshes the Supabase auth session on every request (persistent login)
 * and redirects unauthenticated users to /login.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() verifies the JWT locally (ES256 / cached JWKS) — no
  // network call unless the access token is expired and needs a refresh.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
