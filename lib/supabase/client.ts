"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";

/**
 * Browser Supabase client for Client Components (inline table editing,
 * search-as-you-type, realtime). RLS gates all data access, so the anon
 * key is safe here.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
