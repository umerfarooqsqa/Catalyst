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
export type BasePageEntry = Tables<"base_page">;
/** @deprecated use BasePageEntry (table renamed master_bugs -> base_page) */
export type MasterBug = BasePageEntry;
export type RequirementDocument = Tables<"requirement_documents">;
export type Bug = Tables<"bugs">;
export type Task = Tables<"tasks">;
export type Attachment = Tables<"attachments">;
export type Comment = Tables<"comments">;
export type Notification = Tables<"notifications">;

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
  contributor: "Contributor — gets assigned work, edits own",
  viewer: "Viewer — read-only",
};
export type BasePageSource = "master_bug" | "client_requirement";
export type RequirementDocStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";
export type Severity = "critical" | "major" | "minor" | "trivial";
export type Priority = "high" | "medium" | "low";
export type BugStatus =
  | "open"
  | "in_progress"
  | "fixed"
  | "ready_for_retest"
  | "reopened"
  | "closed";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type RequirementStatus = "draft" | "active" | "deprecated";
export type TestCaseStatus = "pending" | "pass" | "fail";

/** A user as shown in assignee pickers. */
export type MemberOption = {
  id: string;
  full_name: string;
  role: string;
  roles: { label: string; assignable: boolean } | null;
};

/** A bug row joined with the display fields the table views need. */
export type BugWithJoins = Bug & {
  assignee: Pick<Profile, "id" | "full_name"> | null;
  category: Pick<BugCategory, "id" | "name"> | null;
  requirement: Pick<Requirement, "id" | "title"> | null;
};

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
  "done",
];
export const REQUIREMENT_STATUSES: RequirementStatus[] = [
  "draft",
  "active",
  "deprecated",
];
export const TEST_CASE_STATUSES: TestCaseStatus[] = ["pending", "pass", "fail"];
