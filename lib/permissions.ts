import type { RoleLevel } from "@/lib/types/models";

/**
 * Permission helpers. They take a role **level** (`admin` / `manager` /
 * `contributor` / `viewer`) — the level a role carries, resolved from the
 * `roles` table. RLS (`is_admin()` / `is_qa_or_admin()` / `is_staff()` in
 * migration 0011) is the real enforcement; this just drives the UI.
 *
 *   admin       full control: users, roles, SLA, categories, projects, every sheet
 *   manager     log bugs, reuse the library, write requirements + test cases,
 *               create/rename projects, create + assign tasks
 *   contributor bugs/tasks can be assigned to them; they edit only their own
 *   viewer      read-only
 */

type L = RoleLevel | null | undefined;

export const isAdmin = (l: L) => l === "admin";
export const isManager = (l: L) => l === "admin" || l === "manager";
export const isContributor = (l: L) => l === "contributor";
export const isStaff = (l: L) =>
  l === "admin" || l === "manager" || l === "contributor";
export const isViewer = (l: L) => l === "viewer" || !l;

export const canManageRequirements = isManager;
export const canAdminister = isAdmin;
export const canManageProjects = isManager;
export const canCreateBugs = isManager;
export const canManageTasks = isManager;
export const canManageMasterLibrary = isManager;

/**
 * May the user edit an arbitrary field on this bug?
 *  - manager / admin: any bug
 *  - contributor: only bugs assigned to them
 *  - viewer: never
 */
export function canEditBug(
  level: L,
  userId: string | null | undefined,
  bug: { assignee_id: string | null; created_by: string | null },
): boolean {
  if (isManager(level)) return true;
  if (isContributor(level)) return !!userId && bug.assignee_id === userId;
  return false;
}

export function canEditTask(
  level: L,
  userId: string | null | undefined,
  task: { assignee_id: string | null; created_by: string | null },
): boolean {
  if (isManager(level)) return true;
  if (isContributor(level))
    return (
      !!userId && (task.assignee_id === userId || task.created_by === userId)
    );
  return false;
}
