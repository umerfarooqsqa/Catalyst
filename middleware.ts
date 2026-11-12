import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and image files, and the machine-only API
     * routes (own shared secrets, never a browser session; PUBLIC_PATHS lets them through anyway).
     * Skipping them saves CPU on the Workers Free plan's 10 ms budget: the runner heartbeat alone
     * arrives every minute.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|\\.well-known/|api/automation|api/monitor/run|api/email/dispatch|api/push/dispatch|api/intake/|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
