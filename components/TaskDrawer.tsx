"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Badge } from "@/components/ui";
import { fmtDateTime, initials, titleCase } from "@/lib/format";
import { canEditTask, canApproveTasks, isManager, isStaff } from "@/lib/permissions";
import type { Task, Profile, Bug, RoleLevel, TaskAuditAction } from "@/lib/types/models";
import { TASK_STATUSES, TASK_AUDIT_ACTION_LABELS } from "@/lib/types/models";

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  author_id: string | null;
  author: { full_name: string } | null;
};

type AuditRow = {
  id: string;
  action: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
  actor_id: string | null;
  actor: { full_name: string } | null;
};

const STATUS_OR_PRIORITY_ACTIONS = new Set(["status_changed", "priority_changed"]);

function describeAudit(row: AuditRow): string {
  const label =
    TASK_AUDIT_ACTION_LABELS[row.action as TaskAuditAction] ?? row.action;
  if (row.action === "created") return label;
  if (STATUS_OR_PRIORITY_ACTIONS.has(row.action)) {
    return `${label} from ${titleCase(row.from_value ?? "—")} to ${titleCase(row.to_value ?? "—")}`;
  }
  if (row.action === "assignee_changed") {
    return `${label} from ${row.from_value ?? "Unassigned"} to ${row.to_value ?? "Unassigned"}`;
  }
  if (row.action === "due_date_changed") {
    return `${label} from ${fmtDateTime(row.from_value)} to ${fmtDateTime(row.to_value)}`;
  }
  return label;
}

export default function TaskDrawer({
  task,
  role,
  userId,
  members,
  bugs,
  onClose,
  onChanged,
}: {
  task: Task;
  role: RoleLevel;
  userId: string;
  members: Pick<Profile, "id" | "full_name">[];
  bugs: Pick<Bug, "id" | "title">[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const editable = canEditTask(role, userId, task);
  const canApprove = canApproveTasks(role);
  const canAssign = isManager(role);
  const [description, setDescription] = useState(task.description ?? "");
  const [savingText, setSavingText] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [newComment, setNewComment] = useState("");
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: commentData }, { data: auditData }] = await Promise.all([
      supabase
        .from("comments")
        .select("id, content, created_at, author_id, author:profiles(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("task_audit_log")
        .select("id, action, from_value, to_value, created_at, actor_id, actor:profiles(full_name)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true }),
    ]);
    setComments((commentData as CommentRow[]) ?? []);
    setAuditLog((auditData as AuditRow[]) ?? []);
  }, [task.id]);

  useEffect(() => {
    setDescription(task.description ?? "");
    load();
  }, [task.id, task.description, load]);

  async function setStatus(status: string) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ status: status as never })
      .eq("id", task.id);
    if (error) setErr(error.message);
    else {
      onChanged();
      load();
    }
  }

  async function setAssignee(assignee_id: string | null) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ assignee_id })
      .eq("id", task.id);
    if (error) setErr(error.message);
    else {
      onChanged();
      load();
    }
  }

  async function saveText() {
    setSavingText(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({ description: description.trim() || null })
      .eq("id", task.id);
    setSavingText(false);
    if (error) setErr(error.message);
    else {
      onChanged();
      load();
    }
  }

  async function addComment() {
    if (!newComment.trim()) return;
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("comments").insert({
      task_id: task.id,
      author_id: userId,
      content: newComment.trim(),
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setNewComment("");
    load();
  }

  const who = members.find((m) => m.id === task.assignee_id)?.full_name;
  const bug = bugs.find((b) => b.id === task.linked_bug_id);
  const statusOptions = canApprove
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => s !== "done");

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-grid-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-grid-line bg-white px-4 py-3 sm:px-5 sm:py-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  task.priority === "high"
                    ? "red"
                    : task.priority === "medium"
                      ? "amber"
                      : "slate"
                }
              >
                {titleCase(task.priority)}
              </Badge>
              <Badge tone={task.status === "done" ? "green" : "blue"}>
                {titleCase(task.status)}
              </Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {task.title}
            </h2>
            <p className="text-xs text-slate-500">
              {who ? `Assigned to ${who}` : "Unassigned"}
              {bug ? ` · linked to ${bug.title}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {(canAssign || editable) && (
            <section className="grid gap-3 rounded-md border border-grid-line bg-grid-head/40 p-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Assigned to
                </label>
                {canAssign ? (
                  <select
                    value={task.assignee_id ?? ""}
                    onChange={(e) => setAssignee(e.target.value || null)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                  >
                    <option value="">— Unassigned —</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[13px] text-slate-700">{who ?? "Unassigned"}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Status
                </label>
                <select
                  value={task.status}
                  disabled={!editable}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[13px] disabled:bg-slate-50"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {editable && task.status !== "pending_approval" && task.status !== "done" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStatus("pending_approval")}>
                Mark done → send for approval
              </Button>
            </div>
          )}
          {task.status === "pending_approval" && canApprove && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStatus("done")}>Approve (mark done)</Button>
              <Button variant="secondary" onClick={() => setStatus("in_progress")}>
                Send back
              </Button>
            </div>
          )}
          {task.status === "pending_approval" && !canApprove && (
            <p className="text-xs text-slate-400">
              Waiting for an admin to approve this as done.
            </p>
          )}
          {task.status === "done" && (
            <p className="text-xs text-slate-400">
              Approved and marked done{task.completed_at ? ` on ${fmtDateTime(task.completed_at)}` : ""}.
            </p>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              Description
            </h3>
            <textarea
              value={description}
              disabled={!editable}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
            {editable && (
              <Button
                variant="secondary"
                className="mt-2"
                onClick={saveText}
                disabled={savingText}
              >
                {savingText ? "Saving…" : "Save text"}
              </Button>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Comments
            </h3>
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                    {initials(c.author?.full_name ?? "?")}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">
                      {c.author?.full_name ?? "Unknown"} ·{" "}
                      <span suppressHydrationWarning>{fmtDateTime(c.created_at)}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-slate-800">
                      {c.content}
                    </p>
                  </div>
                </li>
              ))}
              {comments.length === 0 && (
                <li className="text-sm text-slate-400">No comments yet</li>
              )}
            </ul>
            {isStaff(role) && (
              <div className="mt-3">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={2}
                  placeholder="Add a comment…"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <Button
                  variant="secondary"
                  className="mt-1"
                  onClick={addComment}
                  disabled={!newComment.trim()}
                >
                  Comment
                </Button>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Audit log
            </h3>
            <ul className="space-y-2">
              {auditLog.map((a) => (
                <li key={a.id} className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">
                    {a.actor?.full_name ?? "System"}
                  </span>{" "}
                  {describeAudit(a)} ·{" "}
                  <span suppressHydrationWarning>{fmtDateTime(a.created_at)}</span>
                </li>
              ))}
              {auditLog.length === 0 && (
                <li className="text-sm text-slate-400">No activity yet</li>
              )}
            </ul>
          </section>

          {err && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
