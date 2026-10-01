"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Button,
  cx,
  PageHeader,
  EmptyState,
  Badge,
  ViewToggle,
  Fab,
} from "@/components/ui";
import DueInput from "@/components/DueInput";
import TaskDrawer from "@/components/TaskDrawer";
import { titleCase, fmtDateTime } from "@/lib/format";
import { fmtDueShort } from "@/lib/parseDue";
import { exportRows } from "@/lib/export";
import { canManageTasks, canEditTask, canApproveTasks, isViewer } from "@/lib/permissions";
import { useGridNav } from "@/lib/useGridNav";
import { useIsMobile } from "@/lib/useIsMobile";
import type { Task, Bug, MemberOption, RoleLevel } from "@/lib/types/models";
import AreaChip from "@/components/AreaChip";
import AssigneeOptions from "@/components/AssigneeOptions";
import { useRoleCategories } from "@/components/RoleCategories";
import { categoryOf, isArea, shortLabel, suggestArea } from "@/lib/bug-area";
import { TASK_STATUSES, PRIORITIES } from "@/lib/types/models";

type TaskRow = Task;
const NAV_COLS = 7; // title, status, priority, category, assignee, linked-bug, due

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
  members: MemberOption[];
  bugs: Pick<Bug, "id" | "title">[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState(initialTasks);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [view, setView] = useState<"cards" | "sheet">("sheet");
  const [viewTouched, setViewTouched] = useState(false);
  const params = useSearchParams();
  const [drawerId, setDrawerId] = useState<string | null>(params.get("focus"));
  // A link to a task (a notification -> /tasks/<id> -> ?focus=<id>) opens its drawer, also when this page is
  // already open. Only a change of the value counts, so a refresh never reopens a drawer the user closed.
  const focusParam = params.get("focus");
  const lastFocus = useRef(focusParam);
  useEffect(() => {
    if (focusParam && focusParam !== lastFocus.current) setDrawerId(focusParam);
    lastFocus.current = focusParam;
  }, [focusParam]);
  const closeDrawer = useCallback(() => {
    setDrawerId(null);
    if (params.get("focus")) {
      // drop ?focus= so the next link to the same task opens it again
      const next = new URLSearchParams(params.toString());
      next.delete("focus");
      router.replace(`${window.location.pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }
  }, [params, router]);
  const newFormRef = useRef<HTMLFormElement>(null);
  const canApprove = canApproveTasks(role);
  const statusOptions = canApprove
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => s !== "done");
  // A row already sitting in a status this role can't *set* (e.g. a
  // contributor viewing an approved task) still needs that value in its
  // own dropdown, or the <select> would silently show the wrong option.
  const rowStatusOptions = (status: TaskRow["status"]) =>
    statusOptions.includes(status) ? statusOptions : [status, ...statusOptions];

  const [nTitle, setNTitle] = useState("");
  const [nDesc, setNDesc] = useState("");
  const [nPriority, setNPriority] = useState("medium");
  const [nAssignee, setNAssignee] = useState("");
  const [nBug, setNBug] = useState("");
  const [nDue, setNDue] = useState<string | null>(null);
  // Role category (migration 0043): suggested from the title until picked. With a category
  // and no assignee, the database gives the task to the least busy person in it.
  const roleCats = useRoleCategories();
  const [nArea, setNArea] = useState("");
  const [nAreaTouched, setNAreaTouched] = useState(false);
  const nAreaSuggestion = useMemo(() => suggestArea(`${nTitle} ${nDesc}`, roleCats), [nTitle, nDesc, roleCats]);
  useEffect(() => {
    if (!nAreaTouched) setNArea(nAreaSuggestion?.area ?? "");
  }, [nAreaSuggestion, nAreaTouched]);
  const [fArea, setFArea] = useState(""); // "" = all, "none" = not set

  useEffect(() => setTasks(initialTasks), [initialTasks]);
  // Default to touch cards on phones; respect a manual switch afterwards.
  useEffect(() => {
    if (!viewTouched) setView(isMobile ? "cards" : "sheet");
  }, [isMobile, viewTouched]);
  const pickView = (v: "cards" | "sheet") => {
    setViewTouched(true);
    setView(v);
  };
  useEffect(() => {
    if (showNew)
      newFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showNew]);
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
      area: nArea || null,
      linked_bug_id: nBug || null,
      due_date: nDue,
    });
    if (error) return setErr(error.message);
    setNTitle("");
    setNDesc("");
    setNPriority("medium");
    setNAssignee("");
    setNArea("");
    setNAreaTouched(false);
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
    if (fArea) rows = rows.filter((t) => (fArea === "none" ? !isArea(roleCats, t.area) : t.area === fArea));
    if (mineOnly) rows = rows.filter((t) => t.assignee_id === userId);
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    rows.sort((a, b) => {
      const d =
        (a.due_date ? Date.parse(a.due_date) : Infinity) -
        (b.due_date ? Date.parse(b.due_date) : Infinity);
      return d !== 0 ? d : order[a.priority] - order[b.priority];
    });
    return rows;
  }, [tasks, q, fStatus, fArea, roleCats, mineOnly, userId]);

  const grid = useGridNav(filtered.length, NAV_COLS);
  const drawerTask = tasks.find((t) => t.id === drawerId) ?? null;

  function doExport() {
    exportRows(
      filtered.map((t) => ({
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        category: shortLabel(roleCats, t.area),
        assignee: members.find((m) => m.id === t.assignee_id)?.full_name ?? "",
        linked_bug: bugs.find((x) => x.id === t.linked_bug_id)?.title ?? "",
        due_date: t.due_date ? fmtDateTime(t.due_date) : "",
      })),
      [
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "status", header: "Status" },
        { key: "priority", header: "Priority" },
        { key: "category", header: "Role Category" },
        { key: "assignee", header: "Assignee" },
        { key: "linked_bug", header: "Linked Bug" },
        { key: "due_date", header: "Due Date" },
      ],
      `${projectName.replace(/\s+/g, "-")}-tasks`,
      "Tasks",
    ).catch((e) => window.alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
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
              <Button
                onClick={() => setShowNew((s) => !s)}
                className="hidden sm:inline-flex"
              >
                + New task
              </Button>
            )}
          </>
        }
      />

      {showNew && canManage && (
        <form
          ref={newFormRef}
          onSubmit={create}
          className="mb-4 scroll-mt-4 space-y-3 rounded-md border border-grid-line bg-white p-4 shadow-card"
        >
          <input
            placeholder="Task title"
            required
            autoFocus
            value={nTitle}
            onChange={(e) => setNTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <textarea
            placeholder="Description"
            rows={2}
            value={nDesc}
            onChange={(e) => setNDesc(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={nPriority}
              onChange={(e) => setNPriority(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-[13px]"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)} priority
                </option>
              ))}
            </select>
            <select
              value={nArea}
              onChange={(e) => {
                setNArea(e.target.value);
                setNAreaTouched(true);
              }}
              aria-label="Role category"
              className={cx(
                "rounded-md border px-3 py-2 text-[13px]",
                nAreaSuggestion && !nAreaTouched ? "border-brand/50 bg-brand/5" : "border-slate-300",
              )}
              title={nAreaSuggestion?.matched.length ? `matched: ${nAreaSuggestion.matched.join(", ")}` : undefined}
            >
              <option value="">No role category</option>
              {roleCats.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                  {nAreaSuggestion?.area === c.key && !nAreaTouched ? " (suggested)" : ""}
                </option>
              ))}
            </select>
            <select
              value={nAssignee}
              onChange={(e) => setNAssignee(e.target.value)}
              aria-label="Assignee"
              className="rounded-md border border-slate-300 px-3 py-2 text-[13px]"
            >
              <option value="">
                {nArea ? `Auto: least busy in ${categoryOf(roleCats, nArea)?.short_label ?? nArea}` : "Unassigned"}
              </option>
              <AssigneeOptions people={members} area={nArea} />
            </select>
            <select
              value={nBug}
              onChange={(e) => setNBug(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-[13px]"
            >
              <option value="">No linked bug</option>
              {bugs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
            <DueInput value={nDue} onCommit={setNDue} onError={setErr} />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={!nTitle.trim()}
              className="flex-1 justify-center py-2 sm:flex-none"
            >
              Create task
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowNew(false)}
              className="py-2"
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
          className="w-40 rounded-md border border-slate-300 px-2 py-1.5 sm:w-48"
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1.5"
        >
          <option value="">Status: all</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        <select
          value={fArea}
          onChange={(e) => setFArea(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1.5"
        >
          <option value="">Category: all</option>
          {roleCats.map((c) => (
            <option key={c.key} value={c.key}>
              {c.short_label}
            </option>
          ))}
          <option value="none">Not set</option>
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Mine
        </label>
        <ViewToggle view={view} onChange={pickView} className="ml-auto" />
      </div>

      {err && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[13px] text-red-700">
          {err}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No tasks match" />
      ) : view === "cards" ? (
        <ul className="space-y-2">
          {filtered.map((t) => {
            const canEdit = canEditTask(role, userId, t);
            const overdue =
              !!t.due_date &&
              Date.parse(t.due_date) < Date.now() &&
              t.status !== "done";
            const bug = bugs.find((x) => x.id === t.linked_bug_id);
            const who = members.find((m) => m.id === t.assignee_id)?.full_name;
            return (
              <li
                key={t.id}
                onClick={() => setDrawerId(t.id)}
                className="cursor-pointer rounded-md border border-grid-line bg-white p-3 shadow-card transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-medium text-slate-800">{t.title}</p>
                  <Badge
                    tone={
                      t.priority === "high"
                        ? "red"
                        : t.priority === "medium"
                          ? "amber"
                          : "slate"
                    }
                  >
                    {titleCase(t.priority)}
                  </Badge>
                </div>
                {t.area && <AreaChip area={t.area} className="mt-1" />}
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-[13px] text-slate-500">
                    {t.description}
                  </p>
                )}
                <div
                  className="mt-2.5 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    value={t.status}
                    disabled={!canEdit}
                    onChange={(e) => patch(t.id, { status: e.target.value })}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700 disabled:opacity-60"
                  >
                    {rowStatusOptions(t.status).map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </select>
                  {t.due_date && (
                    <span
                      suppressHydrationWarning
                      className={cx(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium",
                        overdue
                          ? "bg-red-50 text-red-700"
                          : "bg-grid-head text-slate-600",
                      )}
                    >
                      📅 {fmtDueShort(t.due_date)}
                      {overdue ? " · overdue" : ""}
                    </span>
                  )}
                  {bug && (
                    <span className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-md bg-blue-50 px-2 py-1.5 text-[12px] text-blue-800">
                      🔗 {bug.title}
                    </span>
                  )}
                </div>
                <div
                  className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2 text-[12px] text-slate-500"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEdit ? (
                    <select
                      value={t.assignee_id ?? ""}
                      onChange={(e) =>
                        patch(t.id, { assignee_id: e.target.value || null })
                      }
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px]"
                    >
                      <option value="">Unassigned</option>
                      <AssigneeOptions people={members} area={t.area} />
                    </select>
                  ) : (
                    <span>👤 {who ?? "Unassigned"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="sheet-wrap rounded-md border border-grid-line">
          <table className="sheet" onKeyDown={grid.onKeyDown}>
            <thead>
              <tr>
                <th className="rownum">#</th>
                <th className="freeze min-w-[16rem]">Title</th>
                <th className="min-w-[8rem]">Status</th>
                <th className="min-w-[6rem]">Priority</th>
                <th className="min-w-[8rem]">Category</th>
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
                      <div className="flex items-center gap-1">
                        <input
                          key={t.title}
                          tabIndex={-1}
                          defaultValue={t.title}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== t.title) patch(t.id, { title: v });
                          }}
                          className="cell-input min-w-0 flex-1 font-medium"
                        />
                        <button
                          tabIndex={-1}
                          onClick={() => setDrawerId(t.id)}
                          title="Open task details"
                          aria-label="Open task details"
                          className="shrink-0 px-0.5 text-slate-400 hover:text-brand-fg"
                        >
                          ↗
                        </button>
                      </div>
                    </td>

                    <td {...grid.cellProps(r, 1)}>
                      <select
                        tabIndex={-1}
                        value={t.status}
                        disabled={!canEdit}
                        onChange={(e) => patch(t.id, { status: e.target.value })}
                        className="cell-input"
                      >
                        {rowStatusOptions(t.status).map((s) => (
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
                        value={t.area ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => patch(t.id, { area: e.target.value || null })}
                        className={cx("cell-input", !t.area && "text-slate-400")}
                      >
                        <option value="">—</option>
                        {roleCats.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.short_label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 4)}>
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
                        <AssigneeOptions people={members} area={t.area} />
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 5)}>
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

                    <td {...grid.cellProps(r, 6)}>
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

      {canManage && <Fab label="New task" onClick={() => setShowNew(true)} />}

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          role={role}
          userId={userId}
          members={members}
          bugs={bugs}
          onClose={closeDrawer}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
