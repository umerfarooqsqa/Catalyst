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
 *   contributor developers: see only their role's platform (Android / iOS, migration
 *               0034); on bugs they may only comment, attach, and move a bug to
 *               In progress or Fixed. They never edit, close or delete one. Tasks:
 *               they edit their own. A lead developer also hands their own bugs
 *               and tasks to junior developers (0040).
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
/** Only an admin may approve a task (move it into 'done') — enforced in RLS too. */
export const canApproveTasks = isAdmin;
export const canManageMasterLibrary = isManager;
/**
 * A lead developer (contributor level + profiles.dev_rank = 'lead', migration 0040)
 * may hand a bug or task assigned to them to a junior developer, re-hand it, or
 * take it back. The database enforces the same rule.
 */
export const isLeadDeveloper = (l: L, rank: string | null | undefined) =>
  isContributor(l) && rank === "lead";
/** The Automation page and each project's Automation tab (runner folders, jobs): not for developers. */
export const canSeeAutomation = (l: L) => !isContributor(l);

/**
 * May the user edit this bug (text, severity, assignee, version, any status, delete)?
 * Only managers/admins. Developers get `developerStatusTargets` instead, and the UI
 * doesn't show them edit controls at all. Migration 0034 enforces the same rule.
 */
export function canEditBug(
  level: L,
  _userId?: string | null,
  _bug?: { assignee_id: string | null; created_by: string | null },
): boolean {
  return isManager(level);
}

/** Statuses a developer may move a bug to from its current status (empty = none). */
export function developerStatusTargets(level: L, status: string): ("in_progress" | "fixed")[] {
  if (!isContributor(level)) return [];
  if (status === "open" || status === "reopened") return ["in_progress", "fixed"];
  if (status === "in_progress") return ["fixed"];
  return [];
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
