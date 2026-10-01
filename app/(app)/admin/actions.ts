"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { canAdminister } from "@/lib/permissions";
import { DEV_RANKS, ROLE_LEVELS } from "@/lib/types/models";
import { isBugArea } from "@/lib/bug-area";
import type { DevRank, RoleLevel, Severity } from "@/lib/types/models";

async function assertAdmin() {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  return createClient();
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function genPassword() {
  // 16 URL-safe chars, enough entropy for a one-time temp password.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64").replace(/[+/=]/g, "").slice(0, 16) + "aA1!";
}

export async function updateUser(formData: FormData) {
  const supabase = await assertAdmin();
  const id = String(formData.get("id"));
  const role = String(formData.get("role"));
  const full_name = String(formData.get("full_name") || "").trim() || undefined;
  // Lead/junior only means something for developer (contributor-level) roles (migration 0040).
  const rank = String(formData.get("dev_rank") || "");
  const { data: roleRow } = await supabase.from("roles").select("level").eq("key", role).maybeSingle();
  const dev_rank =
    roleRow?.level === "contributor" && DEV_RANKS.includes(rank as DevRank) ? rank : null;
  // Skills: any combination of frontend / backend / database / devops (migration 0042).
  const skills = [...new Set(formData.getAll("skills").map(String).filter(isBugArea))];
  const { error } = await supabase
    .from("profiles")
    .update({ role, dev_rank, skills, ...(full_name ? { full_name } : {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}

export async function saveCategory(formData: FormData) {
  const supabase = await assertAdmin();
  const id = String(formData.get("id") || "") || null;
  const name = String(formData.get("name") || "").trim();
  const default_severity = String(formData.get("default_severity")) as Severity;
  const template_steps = String(formData.get("template_steps") || "") || null;
  const areaRaw = String(formData.get("default_area") || "");
  const default_area = isBugArea(areaRaw) ? areaRaw : null;
  const keyword_hints = String(formData.get("keyword_hints") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name) throw new Error("Name is required");

  const payload = {
    name,
    default_severity: default_severity as never,
    default_area,
    template_steps,
    keyword_hints,
  };
  const { error } = id
    ? await supabase.from("bug_categories").update(payload).eq("id", id)
    : await supabase.from("bug_categories").insert(payload);
  if (error) throw new Error(error.message);
  revalidateTag("categories");
  revalidatePath("/admin/categories");
}

/* ------------------------------- Roles -------------------------------- */

export async function saveRole(formData: FormData) {
  const supabase = await assertAdmin();
  const id = String(formData.get("id") || "") || null;
  const label = String(formData.get("label") || "").trim();
  const level = String(formData.get("level")) as RoleLevel;
  const assignable = formData.get("assignable") === "on";
  const is_default = formData.get("is_default") === "on";
  const sort_order = Number(formData.get("sort_order")) || 100;
  // A role tied to a platform sees only that platform's projects (migration 0034).
  const platformRaw = String(formData.get("platform") || "");
  const platform = platformRaw === "android" || platformRaw === "ios" ? platformRaw : null;

  if (!label) throw new Error("Label is required");
  if (!ROLE_LEVELS.includes(level)) throw new Error("Invalid permission level");

  // Only one role may be the default — clear any other default first.
  if (is_default) {
    await supabase
      .from("roles")
      .update({ is_default: false })
      .eq("is_default", true);
  }

  if (id) {
    const { error } = await supabase
      .from("roles")
      .update({ label, level, assignable, is_default, sort_order, platform })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const key = slugify(label);
    if (!key) throw new Error("Could not derive a key from that label");
    const { error } = await supabase
      .from("roles")
      .insert({ key, label, level, assignable, is_default, sort_order, platform });
    if (error) throw new Error(error.message);
  }

  revalidateTag("roles");
  revalidatePath("/admin/roles");
  revalidatePath("/", "layout");
}

export async function deleteRole(formData: FormData) {
  const supabase = await assertAdmin();
  const id = String(formData.get("id"));

  const { data: role } = await supabase
    .from("roles")
    .select("id, key, level, is_default")
    .eq("id", id)
    .single();
  if (!role) throw new Error("Role not found");
  if (role.is_default)
    throw new Error("Can't delete the default role. Make another role the default first.");

  const { count: users } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", role.key);
  if (users && users > 0)
    throw new Error(
      `${users} user(s) still have this role. Reassign them before deleting it.`,
    );

  if (role.level === "admin") {
    const { count: admins } = await supabase
      .from("roles")
      .select("id", { count: "exact", head: true })
      .eq("level", "admin");
    if (admins !== null && admins <= 1)
      throw new Error("Can't delete the last admin-level role.");
  }

  const { error } = await supabase.from("roles").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidateTag("roles");
  revalidatePath("/admin/roles");
  revalidatePath("/", "layout");
}

/* ------------------------------- Users -------------------------------- */

export async function createUser(formData: FormData) {
  const { admin } = await getAdminClient();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const full_name = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "").trim();
  if (!email || !full_name || !role) throw new Error("Email, name and role are required");

  const password = genPassword();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
  // Surface the one-time password back to the admin via the redirect target.
  redirect(
    `/admin/users?created=${encodeURIComponent(email)}&pw=${encodeURIComponent(password)}`,
  );
}

export async function setUserPassword(formData: FormData) {
  const { admin } = await getAdminClient();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing user id");
  const generate = formData.get("generate") === "1";

  const password = generate
    ? genPassword()
    : String(formData.get("password") || "");
  if (password.length < 8)
    throw new Error("Password must be at least 8 characters.");

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) throw new Error(error.message);

  const { data: target } = await admin
    .from("profiles")
    .select("email")
    .eq("id", id)
    .single();
  const who = target?.email || id;

  revalidatePath("/admin/users");
  redirect(
    `/admin/users?pwset=${encodeURIComponent(who)}` +
      (generate ? `&pw=${encodeURIComponent(password)}` : ""),
  );
}

export async function deleteUser(formData: FormData) {
  const { admin, actorId } = await getAdminClient();
  const id = String(formData.get("id"));
  if (id === actorId) throw new Error("You can't delete your own account.");

  // Block deleting the last admin-level user.
  const { data: target } = await admin
    .from("profiles")
    .select("role, roles(level)")
    .eq("id", id)
    .single();
  const targetLevel = (target?.roles as { level: string } | null)?.level;
  if (targetLevel === "admin") {
    const { data: adminRoleKeys } = await admin
      .from("roles")
      .select("key")
      .eq("level", "admin");
    const keys = (adminRoleKeys ?? []).map((r) => r.key);
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("role", keys.length ? keys : ["__none__"]);
    if (count !== null && count <= 1)
      throw new Error("Can't delete the last admin user.");
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}
