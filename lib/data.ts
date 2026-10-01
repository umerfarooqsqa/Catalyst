import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { BugCategory, MemberOption } from "@/lib/types/models";

/**
 * Cross-request cache for bug categories. They change rarely and are
 * non-sensitive (anon-readable, see migration 0010), so we use a plain
 * anon client here — `unstable_cache` callbacks run outside request scope
 * and cannot read cookies.
 *
 * Bust with `revalidateTag("categories")` from the admin category action.
 */
export const getCategories = unstable_cache(
  async (): Promise<BugCategory[]> => {
    const sb = createSbClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await sb.from("bug_categories").select("*").order("name");
    return (data as BugCategory[] | null) ?? [];
  },
  ["bug-categories"],
  { revalidate: 300, tags: ["categories"] },
);

/**
 * The member list for assignee dropdowns, joined with each user's role
 * (for the label + the `assignable` flag). Deduped per request.
 */
export const getMembers = cache(async (): Promise<MemberOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, roles(label, assignable, level, platform)")
    .order("full_name");
  return (data as MemberOption[] | null) ?? [];
});

/** Only the members who can be assigned bugs/tasks. */
export const getAssignableMembers = cache(async (): Promise<MemberOption[]> => {
  const all = await getMembers();
  return all.filter((m) => m.roles?.assignable !== false);
});
