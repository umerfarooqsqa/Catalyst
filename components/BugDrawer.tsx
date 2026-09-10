"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Badge } from "@/components/ui";
import { fmtDateTime, initials } from "@/lib/format";
import { SEVERITY_LABELS } from "@/lib/severity";
import { canEditBug, isManager, isStaff } from "@/lib/permissions";
import type {
  BugWithJoins,
  MemberOption,
  RoleLevel,
} from "@/lib/types/models";
import { BUG_STATUSES } from "@/lib/types/models";
import { titleCase } from "@/lib/format";

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  author_id: string | null;
  author: { full_name: string } | null;
};
type AttachmentRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
};

export default function BugDrawer({
  bug,
  role,
  userId,
  assignable,
  onClose,
  onChanged,
}: {
  bug: BugWithJoins;
  role: RoleLevel;
  userId: string;
  assignable: MemberOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const editable = canEditBug(role, userId, bug);
  const canAssign = isManager(role);
  const [description, setDescription] = useState(bug.description ?? "");
  const [steps, setSteps] = useState(bug.steps_to_reproduce ?? "");
  const [savingText, setSavingText] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [newComment, setNewComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase
        .from("comments")
        .select("id, content, created_at, author_id, author:profiles(full_name)")
        .eq("bug_id", bug.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("attachments")
        .select("id, file_name, file_path, file_size_bytes, created_at")
        .eq("bug_id", bug.id)
        .order("created_at", { ascending: true }),
    ]);
    setComments((c as CommentRow[]) ?? []);
    setAttachments((a as AttachmentRow[]) ?? []);
  }, [bug.id]);

  useEffect(() => {
    setDescription(bug.description ?? "");
    setSteps(bug.steps_to_reproduce ?? "");
    load();
  }, [bug.id, bug.description, bug.steps_to_reproduce, load]);

  async function saveText() {
    setSavingText(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({
        description: description.trim() || null,
        steps_to_reproduce: steps.trim() || null,
      })
      .eq("id", bug.id);
    setSavingText(false);
    if (error) setErr(error.message);
    else onChanged();
  }

  async function setStatus(status: string) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({ status: status as never })
      .eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  async function setAssignee(assignee_id: string | null) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({ assignee_id })
      .eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  async function addComment() {
    if (!newComment.trim()) return;
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("comments").insert({
      bug_id: bug.id,
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

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    const supabase = createClient();
    const path = `${bug.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(path, file);
    if (upErr) {
      setErr(upErr.message);
      return;
    }
    const { error } = await supabase.from("attachments").insert({
      bug_id: bug.id,
      file_path: path,
      file_name: file.name,
      file_size_bytes: file.size,
      uploaded_by: userId,
    });
    if (error) setErr(error.message);
    e.target.value = "";
    load();
  }

  async function openAttachment(a: AttachmentRow) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("attachments")
      .createSignedUrl(a.file_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

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
                  bug.severity === "critical"
                    ? "red"
                    : bug.severity === "major"
                      ? "amber"
                      : "slate"
                }
              >
                {SEVERITY_LABELS[bug.severity]}
              </Badge>
              <Badge tone="blue">{titleCase(bug.status)}</Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {bug.title}
            </h2>
            <p className="text-xs text-slate-500">
              {bug.category?.name ?? "Uncategorised"}
              {bug.requirement ? ` · violates ${bug.requirement.title}` : ""}
              {bug.assignee ? ` · assigned to ${bug.assignee.full_name}` : ""}
            </p>
            {bug.base_page_id && (
              <p className="mt-1 text-xs text-slate-400">
                Originated from a library entry (informational only).
              </p>
            )}
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
            <section className="grid gap-3 rounded-sm border border-grid-line bg-grid-head/40 p-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Assigned to
                </label>
                {canAssign ? (
                  <select
                    value={bug.assignee_id ?? ""}
                    onChange={(e) => setAssignee(e.target.value || null)}
                    className="w-full rounded-sm border border-slate-300 px-2 py-1.5 text-[13px]"
                  >
                    <option value="">— Unassigned —</option>
                    {bug.assignee_id &&
                      !assignable.some((m) => m.id === bug.assignee_id) && (
                        <option value={bug.assignee_id}>
                          {bug.assignee?.full_name ?? "Unknown"}
                        </option>
                      )}
                    {assignable.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                        {m.roles?.label ? ` · ${m.roles.label}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[13px] text-slate-700">
                    {bug.assignee?.full_name ?? "Unassigned"}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Status
                </label>
                <select
                  value={bug.status}
                  disabled={!editable}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-sm border border-slate-300 px-2 py-1.5 text-[13px] disabled:bg-slate-50"
                >
                  {BUG_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              {bug.status !== "ready_for_retest" && (
                <Button variant="secondary" onClick={() => setStatus("fixed")}>
                  Mark fixed
                </Button>
              )}
              <Button onClick={() => setStatus("ready_for_retest")}>
                Mark fixed → ready for retest
              </Button>
            </div>
          )}
          <p className="text-xs text-slate-400">
            “Ready for retest” notifies the bug reporter to verify the fix.
          </p>

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              Description
            </h3>
            <textarea
              value={description}
              disabled={!editable}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
            <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">
              Steps to reproduce
            </h3>
            <textarea
              value={steps}
              disabled={!editable}
              onChange={(e) => setSteps(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs disabled:bg-slate-50"
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
              Attachments
            </h3>
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => openAttachment(a)}
                    className="text-sm text-brand hover:underline"
                  >
                    {a.file_name}
                  </button>
                  <span className="ml-2 text-xs text-slate-400">
                    {a.file_size_bytes
                      ? `${Math.round(a.file_size_bytes / 1024)} KB`
                      : ""}
                  </span>
                </li>
              ))}
              {attachments.length === 0 && (
                <li className="text-sm text-slate-400">None</li>
              )}
            </ul>
            {isStaff(role) && (
              <input
                type="file"
                onChange={upload}
                className="mt-2 text-xs"
              />
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
                      {fmtDateTime(c.created_at)}
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
