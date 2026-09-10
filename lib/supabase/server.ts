import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

/**
 * Server Supabase client for Server Components / Route Handlers / Server
 * Actions. Wired to Next's cookie store so the auth session persists
 * server-side.
 *
 * Wrapped in React `cache()` so a single request/render reuses ONE client
 * — every `.from()` / `.auth` call on the returned client shares the same
 * connection and the same in-flight auth state, instead of each caller
 * spinning up its own.
 *
 * The `setAll` try/catch is required because Server Components cannot set
 * cookies — middleware refreshes the session there.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    },
  );
});
