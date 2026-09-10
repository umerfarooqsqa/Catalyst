"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAdminister, canManageProjects } from "@/lib/permissions";

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
