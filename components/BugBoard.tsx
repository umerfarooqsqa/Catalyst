"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, cx, PageHeader, EmptyState } from "@/components/ui";
import NewBugDialog from "@/components/NewBugDialog";
import BugDrawer from "@/components/BugDrawer";
import DueInput from "@/components/DueInput";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, titleCase } from "@/lib/format";
import { exportRows } from "@/lib/export";
import { canCreateBugs, canEditBug, isManager, isViewer } from "@/lib/permissions";
import { useGridNav } from "@/lib/useGridNav";
import type {
  BugWithJoins,
  BugCategory,
  MemberOption,
  Requirement,
  RoleLevel,
  Severity,
} from "@/lib/types/models";
import { SEVERITIES, PRIORITIES, BUG_STATUSES } from "@/lib/types/models";

type Props = {
  projectId: string;
  projectName: string;
  initialBugs: BugWithJoins[];
  categories: BugCategory[];
  requirements: Pick<Requirement, "id" | "title">[];
  members: MemberOption[];
  role: RoleLevel;
  userId: string;
};

type SortKey = "title" | "severity" | "priority" | "status" | "due_date";
const SEV_RANK: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  trivial: 3,
};
const NAV_COLS = 7; // title, severity, priority, status, assignee, category, due

export default function BugBoard({
  projectId,
  projectName,
  initialBugs,
  categories,
  requirements,
  members,
  role,
  userId,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [bugs, setBugs] = useState(initialBugs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(
    params.get("focus") || params.get("bug"),
  );
  const [err, setErr] = useState<string | null>(null);
  const lastClickedRow = useRef<number | null>(null);

  const [q, setQ] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "due_date",
    dir: 1,
  });

  useEffect(() => setBugs(initialBugs), [initialBugs]);
  const refresh = useCallback(() => router.refresh(), [router]);

  // full list resolves names; only assignable users appear in pickers
  const assignable = useMemo(
    () => members.filter((m) => m.roles?.assignable !== false),
    [members],
  );
  const memberName = useCallback(
    (id: string | null) =>
      id ? (members.find((m) => m.id === id)?.full_name ?? "?") : "—",
    [members],
  );

  async function patch(id: string, patch: Record<string, unknown>) {
    setErr(null);
    const prev = bugs;
    setBugs((bs) =>
      bs.map((b) => (b.id === id ? ({ ...b, ...patch } as BugWithJoins) : b)),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update(patch as never)
      .eq("id", id);
    if (error) {
      setErr(error.message);
      setBugs(prev);
    } else refresh();
  }

  async function bulkPatch(patch: Record<string, unknown>) {
    if (selected.size === 0) return;
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update(patch as never)
      .in("id", [...selected]);
    if (error) setErr(error.message);
    setSelected(new Set());
    refresh();
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} bug(s)? This cannot be undone.`))
      return;
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .delete()
      .in("id", [...selected]);
    if (error) setErr(error.message);
    setSelected(new Set());
    refresh();
  }

  const filtered = useMemo(() => {
    let rows = bugs.slice();
    if (hideClosed) rows = rows.filter((b) => b.status !== "closed");
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (b) =>
          b.title.toLowerCase().includes(s) ||
          (b.description ?? "").toLowerCase().includes(s),
      );
    }
    if (fSeverity) rows = rows.filter((b) => b.severity === fSeverity);
    if (fStatus) rows = rows.filter((b) => b.status === fStatus);
    if (fAssignee)
      rows = rows.filter((b) =>
        fAssignee === "none" ? !b.assignee_id : b.assignee_id === fAssignee,
      );
    if (mineOnly) rows = rows.filter((b) => b.assignee_id === userId);

    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sort.key) {
        case "severity":
          av = SEV_RANK[a.severity];
          bv = SEV_RANK[b.severity];
          break;
        case "priority":
          av = PRIORITIES.indexOf(a.priority);
          bv = PRIORITIES.indexOf(b.priority);
          break;
        case "status":
          av = BUG_STATUSES.indexOf(a.status);
          bv = BUG_STATUSES.indexOf(b.status);
          break;
        case "due_date":
          av = a.due_date ? Date.parse(a.due_date) : Infinity;
          bv = b.due_date ? Date.parse(b.due_date) : Infinity;
          break;
        default:
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
      }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
    return rows;
  }, [bugs, q, fSeverity, fStatus, fAssignee, mineOnly, hideClosed, sort, userId]);

  const grid = useGridNav(filtered.length, NAV_COLS);

  // global shortcuts: n / a / d
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if (drawerId || showNew) return;
      if (e.key === "n" && canCreateBugs(role)) {
        e.preventDefault();
        setShowNew(true);
      } else if (e.key === "d" && selected.size > 0) {
        e.preventDefault();
        bulkPatch({ status: "closed" });
      } else if (e.key === "a" && selected.size > 0) {
        e.preventDefault();
        const who = prompt(
          `Assign ${selected.size} bug(s) to (type a name):\n` +
            assignable.map((m) => m.full_name).join("\n"),
        );
        const m = assignable.find(
          (x) => x.full_name.toLowerCase() === (who ?? "").toLowerCase().trim(),
        );
        if (m) bulkPatch({ assignee_id: m.id });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, selected, drawerId, showNew, assignable]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
  }

  function toggleRow(rowIndex: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedRow.current != null) {
        const [a, b] = [lastClickedRow.current, rowIndex].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(filtered[i].id);
      } else {
        const id = filtered[rowIndex].id;
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    lastClickedRow.current = rowIndex;
  }

  function doExport() {
    exportRows(
      filtered.map((b) => ({
        title: b.title,
        description: b.description,
        steps_to_reproduce: b.steps_to_reproduce,
        severity: b.severity,
        priority: b.priority,
        status: b.status,
        category: b.category?.name ?? "",
        requirement: b.requirement?.title ?? "",
        assignee: memberName(b.assignee_id),
        due_date: b.due_date ? fmtDateTime(b.due_date) : "",
      })),
      [
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "steps_to_reproduce", header: "Steps to Reproduce" },
        { key: "severity", header: "Severity" },
        { key: "priority", header: "Priority" },
        { key: "status", header: "Status" },
        { key: "category", header: "Category" },
        { key: "requirement", header: "Requirement" },
        { key: "assignee", header: "Assignee" },
        { key: "due_date", header: "Due Date" },
      ],
      `${projectName.replace(/\s+/g, "-")}-bugs`,
      "Bugs",
    );
  }

  const drawerBug = bugs.find((b) => b.id === drawerId) ?? null;
  const readonly = isViewer(role);
  const allSelected =
    filtered.length > 0 && filtered.every((b) => selected.has(b.id));

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <button
      onClick={() => toggleSort(k)}
      className="flex w-full items-center gap-1 text-left hover:text-slate-900"
    >
      {children}
      <span className="text-[10px] text-slate-400">
        {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Bugs"
        subtitle={
          <>
            {filtered.length} rows · click a cell then use arrow keys · Enter to
            edit.{" "}
            {!readonly && (
              <span className="hidden sm:inline">
                <span className="kbd">n</span> new{" "}
                <span className="kbd">a</span> assign{" "}
                <span className="kbd">d</span> done
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={doExport}>
              Export .xlsx
            </Button>
            {canCreateBugs(role) && (
              <Button onClick={() => setShowNew(true)}>+ New bug</Button>
            )}
          </>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <input
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-40 rounded-sm border border-slate-300 px-2 py-1 sm:w-56"
        />
        <select
          value={fSeverity}
          onChange={(e) => setFSeverity(e.target.value)}
          className="rounded-sm border border-slate-300 px-1.5 py-1"
        >
          <option value="">Severity: all</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="rounded-sm border border-slate-300 px-1.5 py-1"
        >
          <option value="">Status: all</option>
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        <select
          value={fAssignee}
          onChange={(e) => setFAssignee(e.target.value)}
          className="rounded-sm border border-slate-300 px-1.5 py-1"
        >
          <option value="">Assignee: any</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
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
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
          />
          Hide closed
        </label>
      </div>

      {selected.size > 0 && !readonly && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-brand-line bg-brand-soft px-2 py-1.5 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) bulkPatch({ status: e.target.value });
              e.target.value = "";
            }}
            className="rounded-sm border border-slate-300 px-1.5 py-0.5"
            defaultValue=""
          >
            <option value="">Set status…</option>
            {BUG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              if (e.target.value)
                bulkPatch({
                  assignee_id: e.target.value === "none" ? null : e.target.value,
                });
              e.target.value = "";
            }}
            className="rounded-sm border border-slate-300 px-1.5 py-0.5"
            defaultValue=""
          >
            <option value="">Assign to…</option>
            <option value="none">Unassign</option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
                {m.roles?.label ? ` · ${m.roles.label}` : ""}
              </option>
            ))}
          </select>
          <Button variant="danger" onClick={bulkDelete}>
            Delete
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-slate-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {err && (
        <p className="mb-2 rounded-sm border border-red-200 bg-red-50 px-2 py-1.5 text-[13px] text-red-700">
          {err}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No bugs match">
          {bugs.length === 0
            ? "Log the first bug for this project."
            : "Adjust the filters above."}
        </EmptyState>
      ) : (
        <div className="sheet-wrap rounded-sm border border-grid-line">
          <table
            className="sheet"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                grid.sel?.c === 0 &&
                !(e.target as HTMLElement)?.closest("input,select,textarea")
              ) {
                e.preventDefault();
                setDrawerId(filtered[grid.sel.r].id);
                return;
              }
              grid.onKeyDown(e);
            }}
          >
            <thead>
              <tr>
                <th
                  className="rownum cursor-pointer"
                  title={allSelected ? "Clear selection" : "Select all rows"}
                  onClick={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(filtered.map((b) => b.id)),
                    )
                  }
                >
                  {allSelected ? "✓" : "#"}
                </th>
                <th className="freeze min-w-[14rem]">
                  <SortHead k="title">Title</SortHead>
                </th>
                <th className="min-w-[6.5rem]">
                  <SortHead k="severity">Severity</SortHead>
                </th>
                <th className="min-w-[6rem]">
                  <SortHead k="priority">Priority</SortHead>
                </th>
                <th className="min-w-[8rem]">
                  <SortHead k="status">Status</SortHead>
                </th>
                <th className="min-w-[9rem]">Assignee</th>
                <th className="min-w-[9rem]">Category</th>
                <th className="min-w-[8rem]">
                  <SortHead k="due_date">Due</SortHead>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, r) => {
                const canEdit = canEditBug(role, userId, b);
                const rowSel = selected.has(b.id);
                return (
                  <tr key={b.id} className={cx(rowSel && "is-selected")}>
                    <td
                      className="rownum cursor-pointer select-none"
                      onClick={(e) => toggleRow(r, e.shiftKey)}
                      title="Click to select row"
                    >
                      {rowSel ? "✓" : r + 1}
                    </td>

                    <td {...grid.cellProps(r, 0, "freeze")}>
                      <div className="flex items-center gap-1">
                        {b.base_page_id && (
                          <span
                            className="shrink-0 text-xs text-slate-400"
                            title="Copied from library"
                          >
                            ⧉
                          </span>
                        )}
                        <input
                          key={b.title}
                          tabIndex={-1}
                          defaultValue={b.title}
                          disabled={!canEdit}
                          title={b.title}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (!v) {
                              e.target.value = b.title;
                            } else if (v !== b.title) {
                              patch(b.id, { title: v });
                            }
                          }}
                          className="cell-input min-w-0 flex-1 font-medium text-slate-800"
                        />
                        <button
                          tabIndex={-1}
                          onClick={() => setDrawerId(b.id)}
                          title="Open bug details"
                          aria-label="Open bug details"
                          className="shrink-0 px-0.5 text-slate-400 hover:text-brand-fg"
                        >
                          ↗
                        </button>
                      </div>
                    </td>

                    <td {...grid.cellProps(r, 1)}>
                      <select
                        tabIndex={-1}
                        value={b.severity}
                        disabled={!canEdit}
                        onChange={(e) => patch(b.id, { severity: e.target.value })}
                        className="cell-input"
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {SEVERITY_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 2)}>
                      <select
                        tabIndex={-1}
                        value={b.priority}
                        disabled={!canEdit}
                        onChange={(e) => patch(b.id, { priority: e.target.value })}
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
                        value={b.status}
                        disabled={!canEdit}
                        onChange={(e) => patch(b.id, { status: e.target.value })}
                        className="cell-input"
                      >
                        {BUG_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 4)}>
                      <select
                        tabIndex={-1}
                        value={b.assignee_id ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          patch(b.id, { assignee_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {b.assignee_id &&
                          !assignable.some((m) => m.id === b.assignee_id) && (
                            <option value={b.assignee_id}>
                              {memberName(b.assignee_id)}
                            </option>
                          )}
                        {assignable.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 5)}>
                      <select
                        tabIndex={-1}
                        value={b.category_id ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          patch(b.id, { category_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td {...grid.cellProps(r, 6)}>
                      <DueInput
                        compact
                        value={b.due_date}
                        disabled={!canEdit}
                        onError={setErr}
                        onCommit={(iso) => patch(b.id, { due_date: iso })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewBugDialog
        projectId={projectId}
        categories={categories}
        requirements={requirements}
        members={assignable}
        userId={userId}
        open={showNew}
        onClose={() => setShowNew(false)}
      />

      {drawerBug && (
        <BugDrawer
          bug={drawerBug}
          role={role}
          userId={userId}
          assignable={assignable}
          onClose={() => setDrawerId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
