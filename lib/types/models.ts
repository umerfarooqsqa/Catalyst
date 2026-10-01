import type { Tables } from "./database";

export type Profile = Tables<"profiles">;
export type RoleRow = Tables<"roles">;
/** A profile joined with its role's display + permission fields. */
export type ProfileWithRole = Profile & {
  roles: Pick<RoleRow, "key" | "label" | "level" | "assignable"> | null;
};
export type Project = Tables<"projects">;
export type ProjectMember = Tables<"project_members">;
export type Requirement = Tables<"requirements">;
export type TestCase = Tables<"test_cases">;
export type BugCategory = Tables<"bug_categories">;
/** A work area an admin manages (Admin -> Role categories, migration 0043). */
export type RoleCategory = Tables<"role_categories">;
export type BasePageEntry = Tables<"base_page">;
export type AutomationRunner = Tables<"automation_runners">;
export type TestJob = Tables<"test_jobs">;
export type ProjectAutomation = Tables<"project_automation">;
/** @deprecated use BasePageEntry (table renamed master_bugs -> base_page) */
export type MasterBug = BasePageEntry;
export type RequirementDocument = Tables<"requirement_documents">;
export type Bug = Tables<"bugs">;
export type Task = Tables<"tasks">;
export type Attachment = Tables<"attachments">;
export type Comment = Tables<"comments">;
export type Notification = Tables<"notifications">;
export type PushSubscriptionRow = Tables<"push_subscriptions">;
export type TaskAuditLog = Tables<"task_audit_log">;
export type AuditLogEntry = Tables<"audit_log">;

/** A role's *key* (dynamic — admins can add roles). */
export type Role = string;
/** The permission level a role carries — this is what drives RLS + UI gating. */
export type RoleLevel = "admin" | "manager" | "contributor" | "viewer";
export const ROLE_LEVELS: RoleLevel[] = [
  "admin",
  "manager",
  "contributor",
  "viewer",
];
export const ROLE_LEVEL_LABELS: Record<RoleLevel, string> = {
  admin: "Admin — full control",
  manager: "Manager — log bugs, requirements, projects, tasks",
  contributor: "Contributor (developer) — comments, marks bugs in progress / fixed; edits own tasks",
  viewer: "Viewer — read-only",
};
/**
 * A developer's rank (profiles.dev_rank, migration 0040). Only meaningful for
 * contributor-level roles. A lead can hand bugs and tasks assigned to them to a
 * junior developer. NULL = a regular developer.
 */
export type DevRank = "lead" | "junior";
export const DEV_RANKS: DevRank[] = ["lead", "junior"];
export const DEV_RANK_LABELS: Record<DevRank, string> = {
  lead: "Lead developer",
  junior: "Junior developer",
};
export type BasePageSource = "master_bug" | "client_requirement";
export type RequirementDocStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";
export type Severity = "critical" | "major" | "minor" | "trivial";
export type Priority = "high" | "medium" | "low";
export type { BugArea } from "@/lib/bug-area";
export type BugStatus =
  | "open"
  | "in_progress"
  | "fixed"
  | "ready_for_retest"
  | "reopened"
  | "closed";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "pending_approval"
  | "done";
export type RequirementStatus = "draft" | "active" | "deprecated";
export type TestCaseStatus = "pending" | "pass" | "fail";

/** A user as shown in assignee pickers. */
export type MemberOption = {
  id: string;
  full_name: string;
  role: string;
  roles: { label: string; assignable: boolean; level?: string; platform?: string | null } | null;
  /** frontend / backend / database / devops, any combination (profiles.skills, migration 0042). */
  skills?: string[] | null;
};

/** A bug row joined with the display fields the table views need. */
export type BugWithJoins = Bug & {
  assignee: Pick<Profile, "id" | "full_name"> | null;
  category: Pick<BugCategory, "id" | "name"> | null;
  requirement: Pick<Requirement, "id" | "title"> | null;
  /** The app version the bug was found in (bugs.release_id -> releases.version). */
  release?: { id: string; version: string } | null;
  /** Who confirmed the bug belongs to that version (bugs.version_confirmed_by, migration 0037). */
  confirmer?: Pick<Profile, "id" | "full_name"> | null;
};

/** A version of the project's app (a release), for choosing which version a bug is in. */
export type ReleaseOption = { id: string; version: string; hasNotes: boolean };

export type TaskWithJoins = Task & {
  assignee: Pick<Profile, "id" | "full_name"> | null;
  linked_bug: Pick<Bug, "id" | "title"> | null;
  project: Pick<Project, "id" | "name"> | null;
};

export const SEVERITIES: Severity[] = ["critical", "major", "minor", "trivial"];
export const PRIORITIES: Priority[] = ["high", "medium", "low"];
export const BUG_STATUSES: BugStatus[] = [
  "open",
  "in_progress",
  "fixed",
  "ready_for_retest",
  "reopened",
  "closed",
];
export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "pending_approval",
  "done",
];
export const REQUIREMENT_STATUSES: RequirementStatus[] = [
  "draft",
  "active",
  "deprecated",
];
export const TEST_CASE_STATUSES: TestCaseStatus[] = ["pending", "pass", "fail"];

/** task_audit_log.action values, written by the tasks_audit_log() DB trigger. */
export type TaskAuditAction =
  | "created"
  | "status_changed"
  | "assignee_changed"
  | "priority_changed"
  | "due_date_changed"
  | "title_edited"
  | "description_edited";

export const TASK_AUDIT_ACTION_LABELS: Record<TaskAuditAction, string> = {
  created: "created the task",
  status_changed: "changed status",
  assignee_changed: "changed assignee",
  priority_changed: "changed priority",
  due_date_changed: "changed due date",
  title_edited: "edited the title",
  description_edited: "edited the description",
};

/** audit_log.entity_type values — the public-schema table names the audit_log_row() trigger is attached to. */
export const AUDIT_LOG_ENTITY_TYPES = [
  "bugs",
  "tasks",
  "requirements",
  "test_cases",
  "projects",
  "comments",
  "attachments",
  "base_page",
  "requirement_documents",
  "profiles",
  "roles",
] as const;
export type AuditLogEntityType = (typeof AUDIT_LOG_ENTITY_TYPES)[number];

export const AUDIT_LOG_ENTITY_LABELS: Record<AuditLogEntityType, string> = {
  bugs: "Bug",
  tasks: "Task",
  requirements: "Requirement",
  test_cases: "Test case",
  projects: "Project",
  comments: "Comment",
  attachments: "Attachment",
  base_page: "Master library",
  requirement_documents: "Requirement document",
  profiles: "User profile",
  roles: "Role",
};

export const AUDIT_LOG_ACTIONS = ["insert", "update", "delete"] as const;
export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];
export const AUDIT_LOG_ACTION_LABELS: Record<AuditLogAction, string> = {
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
};
