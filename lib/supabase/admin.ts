import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { requireProfile } from "@/lib/auth";
import { canAdminister } from "@/lib/permissions";

/**
 * A Supabase client authenticated with the **service_role** key. It bypasses
 * RLS and can call the GoTrue admin API (`auth.admin.*`), so it must NEVER be
 * imported into a Client Component or exposed to the browser — hence
 * `server-only` and a non-`NEXT_PUBLIC_` env var.
 *
 * Only reachable through {@link getAdminClient}, which re-checks that the
 * caller is an admin against the *real* (cookie-scoped, RLS-bound) session
 * before handing back the privileged client.
 */
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — user/role administration is disabled.",
    );
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Assert the current session belongs to an admin, then return the
 * service-role client. Call this at the top of every admin-only server
 * action that needs to bypass RLS.
 */
export async function getAdminClient() {
  const { userId, level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  return { admin: serviceClient(), actorId: userId };
}

/**
 * Service-role client for server contexts that have **no user session** to
 * authorize against — inbound webhooks, cron jobs. The caller is
 * responsible for its own authentication (e.g. a shared-secret header).
 * Throws if the service_role key isn't configured.
 */
export function serviceRoleClient() {
  return serviceClient();
}
