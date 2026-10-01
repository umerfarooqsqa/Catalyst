"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAdminister, canManageProjects, isManager } from "@/lib/permissions";
import { normalizeVersion } from "@/lib/release-notes";

export async function createProject(formData: FormData) {
  const { userId, level } = await requireProfile();
  if (!canManageProjects(level)) throw new Error("Not authorized");

  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  if (!name) throw new Error("Name is required");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, description, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout"); // refresh the sidebar project list
  redirect(`/projects/${data.id}`);
}

export async function deleteProject(formData: FormData) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");

  const projectId = String(formData.get("project_id") || "");
  const confirm = String(formData.get("confirm") || "").trim();
  if (!projectId) throw new Error("Missing project id");

  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (readErr || !project) throw new Error("Project not found");

  // Belt-and-braces: the client gates the button on this too, but never
  // trust that — a mismatched confirmation must not delete anything.
  if (confirm !== project.name)
    throw new Error("Type the project name exactly to confirm deletion.");

  // Every child table (bugs, tasks, requirements, test_cases, base_page
  // client_requirement rows, requirement_documents, sla_settings,
  // project_members — and their own children: comments, attachments,
  // notifications) is ON DELETE CASCADE, so this one delete clears the
  // whole project. RLS still gates it to admins.
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout"); // refresh the sidebar project list
  redirect("/projects");
}

export async function addProjectMember(formData: FormData) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  const project_id = String(formData.get("project_id"));
  const user_id = String(formData.get("user_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .upsert({ project_id, user_id });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}/settings`);
}

export async function removeProjectMember(formData: FormData) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  const project_id = String(formData.get("project_id"));
  const user_id = String(formData.get("user_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", project_id)
    .eq("user_id", user_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}/settings`);
}

/**
 * Sets which platform a project belongs to. The Master Bug Library connects
 * Android entries only to Android projects and iOS entries only to iOS ones,
 * so this decides which library list a project can pull from. Projects that
 * are half of a house's Android/iOS pair (house_group set) are locked: their
 * platform is what links them to their sibling and the automation mapping.
 */
export async function updateProjectPlatform(formData: FormData) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  const project_id = String(formData.get("project_id"));
  const platform = String(formData.get("platform") || "");
  if (platform !== "android" && platform !== "ios") throw new Error("Choose Android or iOS.");

  const supabase = await createClient();
  const { data: project, error: readErr } = await supabase
    .from("projects")
    .select("house_group, house_slug")
    .eq("id", project_id)
    .single();
  if (readErr || !project) throw new Error("Project not found");
  if (project.house_group || project.house_slug)
    throw new Error("This project is part of a house's Android/iOS pair; its platform can't be changed.");

  const { error } = await supabase.from("projects").update({ platform }).eq("id", project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}/settings`);
  revalidatePath("/master-library");
}

/**
 * "App versions" panel on the Bugs page (QA/admin): adds a version of this app that
 * bugs can be filed under, and optionally makes it the project's current version (the
 * default for new bugs). Writes under the user's session (RLS `releases_qa_insert`,
 * migration 0037). Adding a version that already exists just returns it.
 * Note: automation runs still need release notes for the current version before they start.
 */
export async function addAppVersion(
  projectId: string,
  rawVersion: string,
  makeCurrent: boolean,
): Promise<{ error?: string; id?: string; version?: string; existed?: boolean }> {
  const { level } = await requireProfile();
  if (!isManager(level)) return { error: "Only QA or an admin can add app versions." };
  const version = normalizeVersion(rawVersion);
  if (!version) return { error: `'${rawVersion}' is not an app version. Write it like 1.0.7.` };

  const supabase = await createClient();
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, notify_emails")
    .eq("id", projectId)
    .maybeSingle();
  if (pErr || !project) return { error: pErr?.message ?? "Project not found." };

  const { data: existing } = await supabase
    .from("releases")
    .select("id")
    .eq("project_id", projectId)
    .eq("version", version)
    .maybeSingle();
  let id = existing?.id;
  if (!id) {
    const { data: created, error } = await supabase
      .from("releases")
      .insert({ project_id: projectId, version, notify_emails: project.notify_emails })
      .select("id")
      .single();
    if (error) return { error: error.message };
    id = created.id;
  }
  if (makeCurrent) {
    const { error } = await supabase.from("projects").update({ current_version: version }).eq("id", projectId);
    if (error) return { error: `Version added, but making it current failed: ${error.message}` };
  }
  revalidatePath(`/projects/${projectId}/bugs`);
  return { id, version, existed: !!existing };
}

/**
 * Sets this house's expected release version + release-notes reference
 * (REQ-2 version gate). Read by the aktrade/akdapiautomation suites via
 * GET /api/automation/version before every run — a mismatch against the
 * app's actual version aborts the whole run.
 */
export async function updateProjectVersion(formData: FormData) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) throw new Error("Not authorized");
  const project_id = String(formData.get("project_id"));
  const current_version = String(formData.get("current_version") || "").trim() || null;
  const release_notes_ref = String(formData.get("release_notes_ref") || "").trim() || null;
  const notify_emails = String(formData.get("notify_emails") || "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ current_version, release_notes_ref, notify_emails })
    .eq("id", project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}/settings`);
}
