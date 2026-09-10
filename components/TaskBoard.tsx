"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, cx, PageHeader, EmptyState } from "@/components/ui";
import DueInput from "@/components/DueInput";
import { titleCase, fmtDateTime } from "@/lib/format";
import { exportRows } from "@/lib/export";
import { canManageTasks, canEditTask, isViewer } from "@/lib/permissions";
import { useGridNav } from "@/lib/useGridNav";
import type { Task, Profile, Bug, RoleLevel } from "@/lib/types/models";
import { TASK_STATUSES, PRIORITIES } from "@/lib/types/models";

type TaskRow = Task;
const NAV_COLS = 6; // title, status, priority, assignee, linked-bug, due

export default function TaskBoard({
  projectId,
  projectName,
  initialTasks,
  members,
  bugs,
  role,
  userId,
}: {
  projectId: string;
  projectName: string;
  initialTasks: TaskRow[];
  members: Pick<Profile, "id" | "full_name">[];
  bugs: Pick<Bug, "id" | "title">[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [mineOnly, setMineOnly] = useState(false);

  const [nTitle, setNTitle] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nPriority, setNPriority] = useState("medium");
  const [nAssignee, setNAssignee] = useState("");
  const [nBug, setNBug] = useState("");
  const [nDue, setNDue] = useState<string | null>(null);

  useEffect(() => setTasks(initialTasks), [initialTasks]);
  const refresh = useCallback(() => router.refresh(), [router]);

  async function patch(id: string, p: Record<string, unknown>) {
    setErr(null);
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update(p as never)
      .eq("id", id);
    if (error) {
      setErr(error.message);
      setTasks(prev);
    } else refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("tasks").insert({
      project_id: projectId,
      title: nTitle.trim(),
      description: nDesc.trim() || null,
      priority: nPriority as never,
      assignee_id: nAssignee || null,
      linked_bug_id: nBug || null,
      due_date: nDue,
    });
    if (error) return setErr(error.message);
    setNTitle("");
    setNDesc("");
    setNPriority("medium");
    setNAssignee("");
    setNBug("");
    setNDue(null);
    setShowNew(false);
    refresh();
  }

  const filtered = useMemo(() => {
    let rows = tasks.slice();
    if (q.trim())
      rows = rows.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    if (fStatus) rows = rows.filter((t) => t.status === fStatus);
    if (mineOnly) rows = rows.filter((t) => t.assignee_id === userId);
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    rows.sort((a, b) => {
      const d =
        (a.due_date ? Date.parse(a.due_date) : Infinity) -
        (b.due_date ? Date.parse(b.due_date) : Infinity);
      return d !== 0 ? d : order[a.priority] - order[b.priority];
    });
    return rows;
  }, [tasks, q, fStatus, mineOnly, userId]);

  const grid = useGridNav(filtered.length, NAV_COLS);

  function doExport() {
    exportRows(
      filtered.map((t) => ({
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: members.find((m) => m.id === t.assignee_id)?.full_name ?? "",
        linked_bug: bugs.find((x) => x.id === t.linked_bug_id)?.title ?? "",
        due_date: t.due_date ? fmtDateTime(t.due_date) : "",
      })),
      [
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "status", header: "Status" },
        { key: "priority", header: "Priority" },
        { key: "assignee", header: "Assignee" },
        { key: "linked_bug", header: "Linked Bug" },
        { key: "due_date", header: "Due Date" },
      ],
      `${projectName.replace(/\s+/g, "-")}-tasks`,
      "Tasks",
    );
  }

  const canManage = canManageTasks(role);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${filtered.length} rows · open backlog, due dates only (no sprints).`}
        actions={
          <>
            <Button variant="secondary" onClick={doExport}>
              Export .xlsx
            </Button>
            {canManage && (
              <Button onClick={() => setShowNew((s) => !s)}>+ New task</Button>
            )}
          </>
        }
      />

      {showNew && canManage && (
        <form
          onSubmit={create}
          className="mb-4 space-y-3 rounded-sm border border-grid-line bg-white p-3"
        >
          <input
            placeholder="Task title"
            required
            value={nTitle}
            onChange={(e) => setNTitle(e.target.value)}
            className="w-full rounded-sm border border-slate-300 px-2.5 py-1.5 text-[13px]"
          />
          <textarea
            placeholder="Description"
            rows={2}
            value={nDesc}
            onChange={(e) => setNDesc(e.target.value)}
            className="w-full rounded-sm border border-slate-300 px-2.5 py-1.5 text-[13px]"
          />
          <div className="grid gap-2 sm:grid-cols-4">
            <select
              value={nPriority}
              onChange={(e) => setNPriority(e.target.value)}
              className="rounded-sm border border-slate-300 px-1.5 py-1.5 text-[13px]"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)}
                </option>
              ))}
            </select>
            <select
              value={nAssignee}
              onChange={(e) => setNAssignee(e.target.value)}
              className="rounded-sm border border-slate-300 px-1.5 py-1.5 text-[13px]"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
            <select
              value={nBug}
              onChange={(e) => setNBug(e.target.value)}
              className="rounded-sm border border-slate-300 px-1.5 py-1.5 text-[13px]"
            >
              <option value="">No linked bug</option>
              {bugs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <div className="w-40">
              <DueInput value={nDue} onCommit={setNDue} onError={setErr} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!nTitle.trim()}>
              Create task
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowNew(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <input
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-40 rounded-sm border border-slate-300 px-2 py-1 sm:w-48"
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="rounded-sm border border-slate-300 px-1.5 py-1"
        >
          <option value="">Status: all</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Mine
        </label>
      </div>

      {err && (
        <p className="mb-2 rounded-sm border border-red-200 bg-red-50 px-2 py-1.5 text-[13px] text-red-700">
          {err}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No tasks match" />
      ) : (
        <div className="sheet-wrap rounded-sm border border-grid-line">
          <table className="sheet" onKeyDown={grid.onKeyDown}>
            <thead>
              <tr>
                <th className="rownum">#</th>
                <th className="freeze min-w-[16rem]">Title</th>
                <th className="min-w-[8rem]">Status</th>
                <th className="min-w-[6rem]">Priority</th>
                <th className="min-w-[9rem]">Assignee</th>
                <th className="min-w-[12rem]">Linked bug</th>
                <th className="min-w-[7rem]">Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, r) => {
                const canEdit = canEditTask(role, userId, t);
                return (
                  <tr key={t.id}>
                    <td className="rownum">{r + 1}</td>

                    <td {...grid.cellProps(r, 0, "freeze")}>
                      <input
                        key={t.title}
                        tabIndex={-1}
                        defaultValue={t.title}
                        disabled={!canEdit}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== t.title) patch(t.id, { title: v });
                        }}
                        className="cell-input font-medium"
                      />
                    </td>

                    <td {...grid.cellProps(r, 1)}>
                      <select
                        tabIndex={-1}
                        value={t.status}
                        disabled={!canEdit}
                        onChange={(e) => patch(t.id, { status: e.target.value })}
                        className="cell-input"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 2)}>
                      <select
                        tabIndex={-1}
                        value={t.priority}
                        disabled={!canEdit}
                        onChange={(e) =>
                          patch(t.id, { priority: e.target.value })
                        }
                        className="cell-input"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {titleCase(p)}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 3)}>
                      <select
                        tabIndex={-1}
                        value={t.assignee_id ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          patch(t.id, { assignee_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 4)}>
                      <select
                        tabIndex={-1}
                        value={t.linked_bug_id ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          patch(t.id, { linked_bug_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {bugs.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 5)}>
                      <DueInput
                        compact
                        value={t.due_date}
                        disabled={!canEdit}
                        onError={setErr}
                        onCommit={(iso) => patch(t.id, { due_date: iso })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
