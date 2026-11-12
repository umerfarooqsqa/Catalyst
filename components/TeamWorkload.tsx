"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, cx } from "@/components/ui";
import { titleCase } from "@/lib/format";

/**
 * "Team workload" on the dashboard (QA/admin, no migration): for each person, how much of the
 * work assigned to them is done and what is still open, from the bugs' and tasks' CURRENT
 * status, credited to the current assignee.
 *   Done                       bug closed                  task done
 *   Waiting for QA / approval  bug fixed, ready for retest task pending approval
 *   In progress                in progress                 in progress
 *   Not started                bug open, reopened          task todo, blocked
 * "Completed" = done + waiting (the developer's part is finished). Click a person for the list of
 * their open items, each linking to the bug/task. The bar's length is the person's total, so
 * rows compare; its segments split it. Colour: ordinal blue (validated) + neutral for not started;
 * numbers are text beside the bar, never colour alone.
 */
export type WorkItem = {
  kind: "bug" | "task";
  id: string;
  title: string;
  status: string;
  rank: number; // severity (bugs) or priority (tasks): 0 = most urgent
  rankLabel: string;
  due_date: string | null;
  created_at: string;
  project: string | null;
  assignee_id: string | null;
  assignee: string | null;
};
type Stage = "done" | "waiting" | "progress" | "todo";

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "done", label: "Done", color: "#0d366b" },
  { key: "waiting", label: "Waiting for QA / approval", color: "#2a78d6" },
  { key: "progress", label: "In progress", color: "#86b6ef" },
  { key: "todo", label: "Not started", color: "#c3c2b7" },
];

export function stageOf(i: Pick<WorkItem, "kind" | "status">): Stage {
  if (i.kind === "bug") {
    if (i.status === "closed") return "done";
    if (i.status === "fixed" || i.status === "ready_for_retest") return "waiting";
    if (i.status === "in_progress") return "progress";
    return "todo";
  }
  if (i.status === "done") return "done";
  if (i.status === "pending_approval") return "waiting";
  if (i.status === "in_progress") return "progress";
  return "todo";
}

type Person = {
  id: string | null; // null = unassigned
  name: string;
  items: WorkItem[];
  n: Record<Stage, number>;
  byKind: Record<Stage, { bug: number; task: number }>;
  total: number;
  completed: number;
  open: number;
};

const DAY = 86_400_000;
const days = (from: number, to: number) => Math.floor((to - from) / DAY);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function TeamWorkload({ items }: { items: WorkItem[] }) {
  const [kind, setKind] = useState<"both" | "bug" | "task">("both");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState<"open" | "completed" | "name">("open");
  const [view, setView] = useState<"bars" | "table">("bars");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const now = useMemo(() => Date.now(), []);

  const projects = useMemo(
    () => [...new Set(items.map((i) => i.project).filter((p): p is string => !!p))].sort(),
    [items],
  );

  const people = useMemo(() => {
    const shown = items.filter((i) => (kind === "both" || i.kind === kind) && (!project || i.project === project));
    const m = new Map<string, Person>();
    for (const i of shown) {
      const key = i.assignee_id ?? "";
      let p = m.get(key);
      if (!p) {
        p = {
          id: i.assignee_id,
          name: i.assignee_id ? (i.assignee ?? "Former user") : "Unassigned",
          items: [],
          n: { done: 0, waiting: 0, progress: 0, todo: 0 },
          byKind: { done: { bug: 0, task: 0 }, waiting: { bug: 0, task: 0 }, progress: { bug: 0, task: 0 }, todo: { bug: 0, task: 0 } },
          total: 0,
          completed: 0,
          open: 0,
        };
        m.set(key, p);
      }
      const s = stageOf(i);
      // Unassigned: only what is still open matters (who'd get credit for the rest?)
      if (!i.assignee_id && s === "done") continue;
      p.items.push(i);
      p.n[s]++;
      p.byKind[s][i.kind]++;
    }
    const list = [...m.values()]
      .map((p) => {
        const completed = p.n.done + p.n.waiting;
        const open = p.n.progress + p.n.todo;
        return { ...p, completed, open, total: completed + open };
      })
      .filter((p) => p.total > 0);
    const people = list.filter((p) => p.id);
    people.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "completed"
          ? b.completed - a.completed || b.open - a.open
          : b.open - a.open || b.completed - a.completed,
    );
    const unassigned = list.find((p) => !p.id);
    return unassigned ? [...people, unassigned] : people;
  }, [items, kind, project, sort]);

  const maxTotal = Math.max(1, ...people.map((p) => p.total));
  const team = people.filter((p) => p.id);
  const sum = (s: Stage) => team.reduce((t, p) => t + p.n[s], 0);

  const seg = (on: boolean) =>
    cx("rounded px-2 py-0.5 text-[12px]", on ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-grid-head");
  const key = (p: Person) => p.id ?? "unassigned";

  function itemLine(i: WorkItem) {
    const s = stageOf(i);
    const due = i.due_date ? Date.parse(i.due_date) : null;
    const late = due !== null && due < now && s !== "waiting";
    return (
      <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
        <Badge tone={i.kind === "bug" ? "red" : "blue"}>{i.kind === "bug" ? "Bug" : "Task"}</Badge>
        <Link
          href={i.kind === "bug" ? `/bugs/${i.id}` : `/tasks/${i.id}`}
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800 hover:underline"
          title={i.title}
        >
          {i.title}
        </Link>
        <span className="text-[11px] text-slate-500">
          {[i.project, titleCase(i.status), i.rankLabel].filter(Boolean).join(" · ")}
        </span>
        {due !== null && (
          <span className={cx("text-[11px]", late ? "font-semibold text-red-700" : "text-slate-500")}>
            {late ? `overdue ${plural(Math.max(1, days(due, now)), "day")}` : `due ${fmtDay(i.due_date!)}`}
          </span>
        )}
        <span className="text-[11px] text-slate-400">open {plural(Math.max(0, days(Date.parse(i.created_at), now)), "day")}</span>
      </li>
    );
  }

  function openList(p: Person) {
    const order = (a: WorkItem, b: WorkItem) => {
      const da = a.due_date ? Date.parse(a.due_date) : Infinity;
      const db = b.due_date ? Date.parse(b.due_date) : Infinity;
      const la = da < now ? 0 : 1;
      const lb = db < now ? 0 : 1;
      return la - lb || da - db || a.rank - b.rank || Date.parse(a.created_at) - Date.parse(b.created_at);
    };
    const todo = p.items.filter((i) => ["todo", "progress"].includes(stageOf(i))).sort(order);
    const waiting = p.items.filter((i) => stageOf(i) === "waiting").sort(order);
    return (
      <div className="mt-2 rounded-md border border-grid-line bg-slate-50/60 px-3 py-2">
        <h4 className="text-[12px] font-semibold text-slate-700">
          Still to do ({todo.length})
        </h4>
        {todo.length ? (
          <ul className="divide-y divide-slate-100">{todo.map(itemLine)}</ul>
        ) : (
          <p className="py-1 text-[12px] text-slate-500">Nothing left to start or finish.</p>
        )}
        {p.id && waiting.length > 0 && (
          <>
            <h4 className="mt-2 text-[12px] font-semibold text-slate-700">
              Waiting for QA / approval ({waiting.length})
            </h4>
            <ul className="divide-y divide-slate-100">{waiting.map(itemLine)}</ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1" role="group" aria-label="Work type">
          {(["both", "bug", "task"] as const).map((k) => (
            <button key={k} className={seg(kind === k)} onClick={() => setKind(k)}>
              {k === "both" ? "Bugs + tasks" : k === "bug" ? "Bugs" : "Tasks"}
            </button>
          ))}
        </div>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-0.5 text-[12px]"
          aria-label="Project"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-md border border-slate-300 px-2 py-0.5 text-[12px]"
          aria-label="Sort"
        >
          <option value="open">Most open first</option>
          <option value="completed">Most completed first</option>
          <option value="name">By name</option>
        </select>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="View">
          <button className={seg(view === "bars")} onClick={() => setView("bars")}>
            Bars
          </button>
          <button className={seg(view === "table")} onClick={() => setView("table")}>
            Table
          </button>
        </div>
      </div>

      <Card className="p-3">
        {people.length === 0 ? (
          <p className="text-[13px] text-slate-500">No assigned bugs or tasks{project ? ` in ${project}` : ""}.</p>
        ) : view === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Person</th>
                  {STAGES.map((s) => (
                    <th key={s.key} className="py-1 pr-3 text-right font-medium">{s.label}</th>
                  ))}
                  <th className="py-1 pr-3 text-right font-medium">Completed</th>
                  <th className="py-1 pr-3 text-right font-medium">Open</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {people.map((p) => (
                  <tr key={key(p)} className={cx("border-t border-grid-line", !p.id && "text-slate-500")}>
                    <td className="py-1 pr-3">{p.name}</td>
                    {STAGES.map((s) => (
                      <td key={s.key} className="py-1 pr-3 text-right">{p.n[s.key]}</td>
                    ))}
                    <td className="py-1 pr-3 text-right font-medium">{p.completed}</td>
                    <td className="py-1 pr-3 text-right font-medium">{p.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
              {STAGES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label} <span className="tabular-nums text-slate-500">{sum(s.key)}</span>
                </span>
              ))}
              <span className="ml-auto text-slate-500">Click a person to see what is still open.</span>
            </div>
            <ul className="space-y-1">
              {people.map((p) => {
                const k = key(p);
                const expanded = !!open[k];
                return (
                  <li key={k} className={cx(!p.id && "mt-2 border-t border-grid-line pt-2")}>
                    <button
                      onClick={() => setOpen({ ...open, [k]: !expanded })}
                      aria-expanded={expanded}
                      className="grid w-full grid-cols-1 items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 text-left hover:bg-slate-50 sm:grid-cols-[9rem_1fr_15rem]"
                    >
                      <span className={cx("truncate text-[13px] font-medium", p.id ? "text-slate-800" : "text-slate-500")}>
                        <span className="mr-1 inline-block w-3 text-slate-400">{expanded ? "▾" : "▸"}</span>
                        {p.name}
                      </span>
                      <span className="block h-4 w-full">
                        <span
                          className="flex h-4 gap-[2px] overflow-hidden rounded"
                          style={{ width: `${Math.max(2, (p.total / maxTotal) * 100)}%` }}
                        >
                          {STAGES.filter((s) => p.n[s.key] > 0).map((s) => (
                            <span
                              key={s.key}
                              className="h-full"
                              style={{ flexGrow: p.n[s.key], flexBasis: 0, minWidth: 3, background: s.color }}
                              onMouseEnter={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                const b = p.byKind[s.key];
                                const parts = [b.bug && plural(b.bug, "bug"), b.task && plural(b.task, "task")].filter(Boolean);
                                setTip({
                                  x: r.left + r.width / 2,
                                  y: r.top,
                                  text: `${p.name} · ${s.label}: ${p.n[s.key]}${parts.length ? ` (${parts.join(", ")})` : ""}`,
                                });
                              }}
                              onMouseLeave={() => setTip(null)}
                            />
                          ))}
                        </span>
                      </span>
                      <span className="text-[12px] text-slate-600">
                        {p.id ? (
                          <>
                            <b className="font-semibold text-slate-800">{p.completed}</b> completed ·{" "}
                            <b className={cx("font-semibold", p.open ? "text-slate-800" : "text-slate-500")}>{p.open}</b> open
                            <span className="ml-1 text-slate-400">
                              ({p.n.done} done, {p.n.waiting} waiting)
                            </span>
                          </>
                        ) : (
                          <>
                            <b className="font-semibold text-slate-700">{p.open}</b> open, nobody assigned
                          </>
                        )}
                      </span>
                    </button>
                    {expanded && openList(p)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-grid-line bg-white px-2 py-1 text-[12px] text-slate-700 shadow-card"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
