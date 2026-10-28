"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LocalTime from "@/components/LocalTime";
import { Badge, cx } from "@/components/ui";
import { WarningCloseAction } from "@/components/QueueActions";
import { LEVELS, warningFacts, type WarningLevel } from "@/lib/monitor/levels";
import { androidName } from "@/lib/monitor/rules";

/** One build of the app as Play has it, with the target SDK read from it (play_builds, 0059). */
export type AppBuild = { version: string | null; code: number | null; target: number | null; min: number | null };

/** The app's versions, shown on every expanded card of that app. */
export type AppVersions = {
  name: string;
  package: string | null;
  /** projects.current_version: the version QA is testing */
  tested: string | null;
  live: AppBuild | null;
  upcoming: (AppBuild & { status: string | null; track: string | null; fraction: number | null }) | null;
  checkedAt: string | null;
};

export type AppWarningItem = {
  id: string;
  project_id: string;
  level: WarningLevel;
  severity: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  action_url: string | null;
  active: boolean;
  data: unknown;
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  reopened_count: number;
  /** "Critical bugs on live" cards: the bugs themselves (open, in progress or reopened). */
  bugs?: { id: string; title: string; status: string; assignee: string | null }[];
};

// Where an app warning came from (migration 0056, lib/monitor).
const WARNING_SOURCE: Record<string, string> = {
  releases: "Play release",
  vitals: "Android vitals",
  target_api: "Target API",
  portal: "Portal",
  play_email: "Play email",
  monitor_play: "Monitor",
  monitor_vitals: "Monitor",
};
const sourceLabel = (s: string) => WARNING_SOURCE[s] ?? (s.startsWith("monitor_stale") ? "Checks stopped" : "Monitor");

const TONE: Record<WarningLevel, { card: string; tab: string; count: string }> = {
  critical: { card: "border-red-300 bg-red-50", tab: "border-red-500 text-red-700", count: "bg-red-600 text-white" },
  live_bugs: { card: "border-rose-300 bg-rose-50", tab: "border-rose-500 text-rose-700", count: "bg-rose-600 text-white" },
  not_critical: { card: "border-amber-300 bg-amber-50", tab: "border-amber-500 text-amber-800", count: "bg-amber-500 text-white" },
  negligible: { card: "border-grid-line bg-white", tab: "border-slate-500 text-slate-700", count: "bg-slate-400 text-white" },
};

function buildText(b: AppBuild | null): string {
  if (!b || (b.version === null && b.code === null)) return "none";
  const name = b.version ?? `build ${b.code}`;
  return b.version && b.code !== null ? `${name} (build ${b.code})` : name;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children}</dd>
    </>
  );
}

function WarningCard({ w, app, open, onToggle }: { w: AppWarningItem; app: AppVersions | undefined; open: boolean; onToggle: () => void }) {
  const facts = warningFacts(w.data);
  const href = w.action_url ?? `/projects/${w.project_id}`;
  const external = /^https?:/.test(href);
  return (
    <li id={`w-${w.id}`} className={cx("flex scroll-mt-20 flex-col rounded-md border p-3 shadow-card", TONE[w.level].card)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="slate">{sourceLabel(w.source)}</Badge>
        {app?.live?.version || app?.tested ? (
          <Badge tone="blue">{app.live?.version ? `Live ${app.live.version}` : `Testing ${app.tested}`}</Badge>
        ) : null}
        {!w.active ? <Badge tone="green">Condition cleared</Badge> : null}
        {w.reopened_count > 0 ? <Badge tone="violet">Back again</Badge> : null}
      </div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="mt-2 text-left">
        <span className={cx("font-medium leading-snug text-slate-800 hover:text-brand-fg", !open && "line-clamp-3")}>{w.title}</span>
      </button>
      <p className="mt-1 truncate text-xs text-slate-500">{app?.name}</p>
      {w.detail ? <p className={cx("mt-1 whitespace-pre-line text-xs text-slate-600", !open && "line-clamp-2")}>{w.detail}</p> : null}
      {w.bugs?.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {(open ? w.bugs : w.bugs.slice(0, 3)).map((b) => (
            <li key={b.id} className="flex items-baseline gap-1.5">
              <span className="text-rose-600">●</span>
              <Link href={`/bugs/${b.id}`} className="min-w-0 flex-1 truncate text-slate-800 hover:text-brand-fg hover:underline">
                {b.title}
              </Link>
              <span className="shrink-0 text-slate-500">
                {b.status.replace(/_/g, " ")}
                {b.assignee ? ` · ${b.assignee}` : " · unassigned"}
              </span>
            </li>
          ))}
          {!open && w.bugs.length > 3 ? <li className="text-slate-500">+{w.bugs.length - 3} more</li> : null}
        </ul>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3 rounded-md border border-grid-line bg-white/70 p-2.5 text-xs">
          <section>
            <h4 className="mb-1 font-semibold text-slate-700">App versions</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <Row label="App">{app?.name ?? "?"}{app?.package ? <span className="text-slate-500"> · {app.package}</span> : null}</Row>
              <Row label="QA is testing">{app?.tested ?? "no version set"}</Row>
              <Row label="Live on Play">
                {buildText(app?.live ?? null)}
                {app?.live?.target ? ` · targets ${androidName(app.live.target)}` : null}
                {app?.live?.min ? ` · min API ${app.live.min}` : null}
              </Row>
              {app?.upcoming ? (
                <Row label="Upcoming">
                  {buildText(app.upcoming)}
                  {app.upcoming.status ? ` · ${app.upcoming.status.replace(/_/g, " ").toLowerCase()}` : null}
                  {app.upcoming.fraction ? ` · ${Math.round(app.upcoming.fraction * 100)}% rollout` : null}
                  {app.upcoming.target ? ` · targets ${androidName(app.upcoming.target)}` : null}
                </Row>
              ) : null}
              {app?.checkedAt ? (
                <Row label="Play checked">
                  <LocalTime value={app.checkedAt} />
                </Row>
              ) : null}
            </dl>
          </section>
          {facts.length > 0 ? (
            <section>
              <h4 className="mb-1 font-semibold text-slate-700">This warning</h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {facts.map((f) => (
                  <Row key={f.label} label={f.label}>{f.value}</Row>
                ))}
              </dl>
            </section>
          ) : null}
          <section>
            <h4 className="mb-1 font-semibold text-slate-700">History</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <Row label="Level">
                {LEVELS.find((l) => l.key === w.level)?.label}
                {w.level === "live_bugs" ? "" : ` (${w.severity === "critical" ? "red" : "amber"} on Google's scale)`}
              </Row>
              <Row label="First seen"><LocalTime value={w.first_seen_at} /></Row>
              <Row label="Last seen"><LocalTime value={w.last_seen_at} /></Row>
              {w.cleared_at ? <Row label="Cleared"><LocalTime value={w.cleared_at} /></Row> : null}
              {w.reopened_count > 0 ? <Row label="Came back">{w.reopened_count}×</Row> : null}
              <Row label="Check">{w.kind.replace(/_/g, " ")}</Row>
            </dl>
          </section>
        </div>
      ) : null}

      <div className="flex-1" />
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-grid-line pt-2.5">
        <WarningCloseAction warningId={w.id} />
        <button type="button" onClick={onToggle} className="text-xs font-medium text-slate-600 hover:underline">
          {open ? "Less ▴" : "Details ▾"}
        </button>
        {external ? (
          <a href={href} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-brand-fg hover:underline">
            Open ↗
          </a>
        ) : (
          <Link href={href} className="ml-auto text-xs font-medium text-brand-fg hover:underline">
            Open ↗
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * My Queue's App warnings for App health: one tab per level (lib/monitor/levels.ts), each card
 * opening in place to the full text, the app's versions on Play and the warning's own facts.
 * A link to /my-queue#w-<id> (bell, push, email) picks that card's tab and opens it.
 */
export default function AppWarningsSection({ items, apps }: { items: AppWarningItem[]; apps: Record<string, AppVersions> }) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l.key, items.filter((w) => w.level === l.key).length])) as Record<WarningLevel, number>;
  const [level, setLevel] = useState<WarningLevel>(() => LEVELS.find((l) => counts[l.key] > 0)?.key ?? "critical");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    function follow() {
      const id = /^#w-(.+)$/.exec(window.location.hash)?.[1];
      const w = id ? items.find((x) => x.id === id) : undefined;
      if (!w) return;
      setLevel(w.level);
      setOpen((s) => new Set(s).add(w.id));
      requestAnimationFrame(() => document.getElementById(`w-${w.id}`)?.scrollIntoView({ block: "start" }));
    }
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [items]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const shown = items.filter((w) => w.level === level);
  const hint = LEVELS.find((l) => l.key === level)?.hint;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        App warnings ({items.length})
        <span className="ml-1 font-normal text-slate-500">· found on Google Play, for App health</span>
      </h2>
      <div role="tablist" className="mb-2 flex flex-wrap gap-1 border-b border-grid-line">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            role="tab"
            type="button"
            aria-selected={level === l.key}
            onClick={() => setLevel(l.key)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium",
              level === l.key ? TONE[l.key].tab : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            {l.label}
            <span className={cx("rounded-full px-1.5 text-[10px] leading-4", counts[l.key] ? TONE[l.key].count : "bg-slate-100 text-slate-500")}>
              {counts[l.key]}
            </span>
          </button>
        ))}
        {shown.length > 1 ? (
          <button
            type="button"
            onClick={() => setOpen((s) => (shown.every((w) => s.has(w.id)) ? new Set() : new Set(shown.map((w) => w.id))))}
            className="ml-auto self-center text-xs font-medium text-slate-600 hover:underline"
          >
            {shown.every((w) => open.has(w.id)) ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      {shown.length > 0 ? (
        <ul className="grid items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((w) => (
            <WarningCard key={w.id} w={w} app={apps[w.project_id]} open={open.has(w.id)} onToggle={() => toggle(w.id)} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-grid-line p-4 text-center text-xs text-slate-500">
          Nothing at this level.
        </p>
      )}
    </section>
  );
}
