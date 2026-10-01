import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  ProfileWithRole,
  Project,
  RoleLevel,
  RoleRow,
} from "@/lib/types/models";

/**
 * The signed-in user's id, or null.
 *
 * Uses `getClaims()` — with this project's asymmetric (ES256) JWT signing
 * key it verifies the access token **locally** against a cached JWKS, so
 * there is no per-request network round-trip to Supabase Auth (unlike
 * `getUser()`). `cache()` dedupes it within one render.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

/**
 * The signed-in user's profile joined with its role (key, label, level,
 * assignable). One fetch per request.
 */
export const getProfile = cache(async (): Promise<ProfileWithRole | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, roles(key, label, level, assignable)")
    .eq("id", userId)
    .single();
  return (data as ProfileWithRole | null) ?? null;
});

/** The signed-in user's permission level. */
export const getRoleLevel = cache(async (): Promise<RoleLevel> => {
  const p = await getProfile();
  return (p?.roles?.level as RoleLevel | undefined) ?? "viewer";
});

/** All roles, ordered for pickers. */
export const getRoles = cache(async (): Promise<RoleRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("*")
    .order("sort_order");
  return data ?? [];
});

/** All projects (for sidebars / pickers / the project header). One fetch per request. */
export const getProjects = cache(
  async (): Promise<Pick<Project, "id" | "name" | "description" | "platform">[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id, name, description, platform")
      .order("name");
    return data ?? [];
  },
);

/**
 * Require a signed-in user with a profile, or redirect to /login.
 * Cheap to call repeatedly (layout + nested layout + page) — the
 * underlying claim check and profile fetch are cached per request.
 */
export async function requireProfile(): Promise<{
  userId: string;
  profile: ProfileWithRole;
  level: RoleLevel;
}> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return {
    userId: profile.id,
    profile,
    level: (profile.roles?.level as RoleLevel | undefined) ?? "viewer",
  };
}

export async function getProfileOrNull(): Promise<{
  userId: string;
  profile: ProfileWithRole;
} | null> {
  const profile = await getProfile();
  return profile ? { userId: profile.id, profile } : null;
}
