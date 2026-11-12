"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, cx } from "@/components/ui";

/**
 * Team activity heatmap on the dashboard (QA/admin; migration 0053, team_activity()).
 * One row per person, one column per day (Asia/Karachi): how many bugs/tasks were ASSIGNED to
 * them that day, and how many they COMPLETED (bug -> fixed / ready for retest / closed; task ->
 * sent for approval / done), credited to whoever the item was assigned to at that moment.
 *
 * Colour: one blue ramp, 5 ordered steps (validated with the dataviz validator: monotone,
 * visible gaps, lightest step 2.1:1 on white), shared by both panels so they compare; an empty
 * day is neutral grey. Hover a cell for the numbers; "Table" shows the totals as a table.
 */
type Kind = "bug" | "task";
type Row = { person_id: string; full_name: string; day: string; kind: Kind; assigned: number; completed: number };
type Cell = { a: Record<Kind, number>; d: Record<Kind, number> };
type Person = { id: string; name: string; byDay: Map<string, Cell>; a: number; d: number; ab: number; at: number; db: number; dt: number };

const STEPS = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"]; // sequential blue 250/350/450/550/700
const EMPTY = "#f0efec";
const RANGES = [14, 28, 90] as const;

const pktToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const label = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function split(c: Record<Kind, number>, kind: "both" | Kind) {
  if (kind !== "both") return c[kind];
  return c.bug + c.task;
}
function detail(c: Record<Kind, number>, kind: "both" | Kind) {
  const parts = [];
  if (kind !== "task" && c.bug) parts.push(plural(c.bug, "bug"));
  if (kind !== "bug" && c.task) parts.push(plural(c.task, "task"));
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export default function TeamActivityHeatmap({ embedded = false }: { embedded?: boolean } = {}) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(28);
  const [kind, setKind] = useState<"both" | Kind>("both");
  const [view, setView] = useState<"heatmap" | "table">("heatmap");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string[] } | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setErr(null);
    createClient()
      .rpc("team_activity", { p_days: days })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setErr(error.message);
        else setRows((data ?? []) as Row[]);
      });
    return () => {
      live = false;
    };
  }, [days]);

  const dayList = useMemo(() => {
    const today = pktToday();
    return Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1)));
  }, [days]);

  const people = useMemo(() => {
    const m = new Map<string, Person>();
    for (const r of rows ?? []) {
      let p = m.get(r.person_id);
      if (!p) {
        p = { id: r.person_id, name: r.full_name, byDay: new Map(), a: 0, d: 0, ab: 0, at: 0, db: 0, dt: 0 };
        m.set(r.person_id, p);
      }
      let c = p.byDay.get(r.day);
      if (!c) p.byDay.set(r.day, (c = { a: { bug: 0, task: 0 }, d: { bug: 0, task: 0 } }));
      c.a[r.kind] += r.assigned;
      c.d[r.kind] += r.completed;
      if (r.kind === "bug") { p.ab += r.assigned; p.db += r.completed; }
      else { p.at += r.assigned; p.dt += r.completed; }
    }
    const list = [...m.values()].map((p) => ({
      ...p,
      a: kind === "bug" ? p.ab : kind === "task" ? p.at : p.ab + p.at,
      d: kind === "bug" ? p.db : kind === "task" ? p.dt : p.db + p.dt,
    }));
    return list
      .filter((p) => p.a + p.d > 0)
      .sort((x, y) => y.a - x.a || y.d - x.d || x.name.localeCompare(y.name));
  }, [rows, kind]);

  // One scale for both panels, so "assigned" and "completed" compare at a glance.
  const max = useMemo(() => {
    let mx = 0;
    for (const p of people)
      for (const c of p.byDay.values()) mx = Math.max(mx, split(c.a, kind), split(c.d, kind));
    return mx;
  }, [people, kind]);
  const step = (v: number) => (v <= 0 || !max ? -1 : Math.min(4, Math.max(0, Math.ceil((v / max) * 5) - 1)));
  const legend = STEPS.map((color, i) => {
    const lo = Math.floor((max * i) / 5) + 1;
    const hi = Math.floor((max * (i + 1)) / 5);
    return { color, text: lo >= hi ? `${hi}` : `${lo}–${hi}`, empty: lo > hi };
  }).filter((l) => !l.empty);

  const cellPx = days > 28 ? 9 : 16;

  function show(e: React.MouseEvent<HTMLElement>, p: Person, day: string) {
    const c = p.byDay.get(day);
    const r = e.currentTarget.getBoundingClientRect();
    const a = c ? split(c.a, kind) : 0;
    const d = c ? split(c.d, kind) : 0;
    setTip({
      x: r.left + r.width / 2,
      y: r.top,
      text: [
        `${p.name} · ${label(day, { weekday: "short", day: "numeric", month: "short" })}`,
        `${a} assigned${c ? detail(c.a, kind) : ""}`,
        `${d} completed${c ? detail(c.d, kind) : ""}`,
      ],
    });
  }

  function panel(title: string, pick: (c: Cell) => number, total: (p: Person) => number) {
    const sum = people.reduce((s, p) => s + total(p), 0);
    return (
      <div>
        <h3 className="mb-1 text-[12px] font-semibold text-slate-700">
          {title} <span className="font-normal text-slate-500">· {sum} in {days} days</span>
        </h3>
        <div
          className="grid items-center gap-[2px]"
          style={{ gridTemplateColumns: `minmax(7rem, 10rem) repeat(${days}, ${cellPx}px) 2.5rem` }}
        >
          <span />
          {dayList.map((d, i) => (
            <span key={d} className="relative h-4 text-[10px] leading-4 text-slate-400">
              {(new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ||
                (i === 0 && (8 - new Date(`${d}T00:00:00Z`).getUTCDay()) % 7 >= 4)) && (
                <span className="absolute left-0 whitespace-nowrap">{label(d, { day: "numeric", month: "short" })}</span>
              )}
            </span>
          ))}
          <span className="text-right text-[10px] text-slate-400">Total</span>
          {people.map((p) => (
            <Row key={p.id}>
              <span className="truncate pr-2 text-[12px] text-slate-700" title={p.name}>
                {p.name}
              </span>
              {dayList.map((d) => {
                const c = p.byDay.get(d);
                const v = c ? pick(c) : 0;
                const s = step(v);
                return (
                  <span
                    key={d}
                    role="img"
                    aria-label={`${p.name}, ${d}: ${v} ${title.toLowerCase()}`}
                    onMouseEnter={(e) => show(e, p, d)}
                    onMouseLeave={() => setTip(null)}
                    className="block rounded-[3px]"
                    style={{ width: cellPx, height: 16, background: s < 0 ? EMPTY : STEPS[s] }}
                  />
                );
              })}
              <span className="text-right text-[12px] tabular-nums text-slate-600">{total(p)}</span>
            </Row>
          ))}
        </div>
      </div>
    );
  }

  const seg = (on: boolean) =>
    cx("rounded px-2 py-0.5 text-[12px]", on ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-grid-head");

  return (
    <section className={embedded ? undefined : "mt-6"}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {!embedded && <h2 className="text-sm font-semibold text-slate-700">Team activity: assigned and completed</h2>}
        <div className="flex items-center gap-1" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r} className={seg(days === r)} onClick={() => setDays(r)}>
              {r} days
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Work type">
          {(["both", "bug", "task"] as const).map((k) => (
            <button key={k} className={seg(kind === k)} onClick={() => setKind(k)}>
              {k === "both" ? "Bugs + tasks" : k === "bug" ? "Bugs" : "Tasks"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="View">
          <button className={seg(view === "heatmap")} onClick={() => setView("heatmap")}>
            Heatmap
          </button>
          <button className={seg(view === "table")} onClick={() => setView("table")}>
            Table
          </button>
        </div>
      </div>

      <Card className="p-3">
        {err ? (
          <p className="text-[13px] text-red-700">{err}</p>
        ) : rows === null ? (
          <p className="text-[13px] text-slate-500">Loading…</p>
        ) : people.length === 0 ? (
          <p className="text-[13px] text-slate-500">No work was assigned or completed in the last {days} days.</p>
        ) : view === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Person</th>
                  <th className="py-1 pr-3 text-right font-medium">Assigned bugs</th>
                  <th className="py-1 pr-3 text-right font-medium">Assigned tasks</th>
                  <th className="py-1 pr-3 text-right font-medium">Completed bugs</th>
                  <th className="py-1 pr-3 text-right font-medium">Completed tasks</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {people.map((p) => (
                  <tr key={p.id} className="border-t border-grid-line">
                    <td className="py-1 pr-3 text-slate-800">{p.name}</td>
                    <td className="py-1 pr-3 text-right">{p.ab}</td>
                    <td className="py-1 pr-3 text-right">{p.at}</td>
                    <td className="py-1 pr-3 text-right">{p.db}</td>
                    <td className="py-1 pr-3 text-right">{p.dt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-4 overflow-x-auto pb-1">
              {panel("Assigned", (c) => split(c.a, kind), (p) => p.a)}
              {panel("Completed", (c) => split(c.d, kind), (p) => p.d)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>Items per day:</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: EMPTY }} /> 0
              </span>
              {legend.map((l) => (
                <span key={l.color} className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: l.color }} /> {l.text}
                </span>
              ))}
              <span className="ml-auto">
                Completed = bug fixed or closed, task sent for approval or done, counted for its assignee.
              </span>
            </div>
          </div>
        )}
      </Card>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-grid-line bg-white px-2 py-1 text-[12px] text-slate-700 shadow-card"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          <div className="font-medium text-slate-800">{tip.text[0]}</div>
          <div>{tip.text[1]}</div>
          <div>{tip.text[2]}</div>
        </div>
      )}
    </section>
  );
}

// A heatmap row: its cells are direct children of the panel grid.
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
