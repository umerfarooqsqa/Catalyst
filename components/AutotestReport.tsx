"use client";

import { useMemo, useState } from "react";
import { areaFromTestKey, isArea, suggestArea } from "@/lib/bug-area";
import { useRoleCategories } from "@/components/RoleCategories";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, PageHeader, Stat } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { exportWorkbook } from "@/lib/export";
import { canCreateBugs } from "@/lib/permissions";
import { RESULT_TONE, label, type AutotestReportData, type ReportFinding } from "@/lib/autotest-report";
import type { RoleLevel } from "@/lib/types/models";

const SEVERITIES = ["critical", "major", "minor", "trivial"];
const REQ_ORDER = ["failed", "not_found", "not_run", "passed", "skipped", "not_testable", "not_covered"];

function ResultBadge({ status }: { status: string }) {
  return <Badge tone={RESULT_TONE[status] ?? "slate"}>{label(status)}</Badge>;
}

function sum(o?: Record<string, number>) {
  return Object.values(o ?? {}).reduce((a, b) => a + b, 0);
}

export default function AutotestReport({
  projectId,
  reportId,
  createdAt,
  report,
  links,
  excel,
  role,
}: {
  projectId: string;
  reportId: string;
  createdAt: string;
  report: AutotestReportData;
  links: Record<string, string>;
  excel: { name: string; url: string } | null;
  role: RoleLevel;
}) {
  const s = report.summary ?? {};
  const t = s.tests ?? {};
  const rq = s.requirements ?? {};
  const pb = s.past_bugs ?? {};
  const lf = report.learned_from ?? {};
  const tests = report.tests ?? [];
  const requirements = useMemo(
    () => [...(report.requirements ?? [])].sort((a, b) => REQ_ORDER.indexOf(a.status) - REQ_ORDER.indexOf(b.status)),
    [report.requirements],
  );
  const pastBugs = report.past_bugs ?? [];
  const findings = report.findings ?? [];
  const [showUnchecked, setShowUnchecked] = useState(false);
  const [openTest, setOpenTest] = useState<string | null>(null);
  const failed = (t.failed ?? 0) + (t.broken ?? 0);
  const others = Object.keys(lf.knowledge?.other_apps ?? {});

  async function exportReport() {
    const app = report.app?.name ?? report.house;
    await exportWorkbook(
      [
        {
          name: "Summary",
          columns: [
            { key: "item", header: "Item", width: 34 },
            { key: "value", header: "Value", width: 70 },
          ],
          rows: [
            { item: "App", value: `${app} (${report.house})` },
            { item: "Version", value: report.app?.version ?? "" },
            { item: "Installed on the phone", value: report.app?.installed ?? "" },
            { item: "Run", value: `${report.run_id} on ${report.runner ?? "?"}` },
            { item: "Finished", value: report.finished ?? "" },
            { item: "Report", value: report.status === "partial" ? `partial: ${report.partial_reason ?? ""}` : "complete" },
            { item: "Tests", value: `${t.passed ?? 0} passed, ${failed} failed, ${t.skipped ?? 0} skipped, of ${t.total ?? 0}` },
            { item: "Requirements", value: `${rq.passed ?? 0} passed, ${rq.failed ?? 0} failed, of ${rq.total ?? 0}` },
            { item: "Past bugs found on this app", value: String(pb.present ?? 0) },
            { item: "Findings", value: String(s.findings?.total ?? 0) },
            { item: "Spend", value: `$${(s.cost_usd ?? 0).toFixed(2)} of $${(s.budget_usd ?? 0).toFixed(0)}` },
          ],
        },
        {
          name: "Findings",
          columns: [
            { key: "type", header: "Type" },
            { key: "severity", header: "Severity" },
            { key: "title", header: "Title" },
            { key: "detail", header: "Detail" },
            { key: "error", header: "Error" },
            { key: "steps", header: "Steps" },
            { key: "test", header: "Test", width: 50 },
            { key: "filed", header: "Filed as bug" },
          ],
          rows: findings.map((f) => ({
            ...f,
            type: label(f.type),
            steps: (f.steps ?? []).map((x, i) => `${i + 1}. ${x}`).join("\n"),
            filed: f.bug_id ? "yes" : "",
          })),
        },
        {
          name: "Requirements",
          columns: [
            { key: "id", header: "Id", width: 12 },
            { key: "title", header: "Requirement" },
            { key: "severity", header: "Severity" },
            { key: "result", header: "Result" },
            { key: "note", header: "Notes" },
            { key: "tests", header: "Tests", width: 50 },
          ],
          rows: requirements.map((r) => ({ ...r, result: label(r.status), tests: r.tests.join("\n") })),
        },
        {
          name: "Past bugs",
          columns: [
            { key: "id", header: "Id", width: 12 },
            { key: "title", header: "Bug" },
            { key: "severity", header: "Severity" },
            { key: "result", header: "On this app" },
            { key: "apps", header: "Seen on" },
            { key: "note", header: "Notes" },
          ],
          rows: pastBugs.map((b) => ({ ...b, result: label(b.status), apps: (b.apps ?? []).join(", ") })),
        },
        {
          name: "Tests",
          columns: [
            { key: "result", header: "Result" },
            { key: "title", header: "Title" },
            { key: "description", header: "What it checks" },
            { key: "nodeid", header: "Test", width: 50 },
            { key: "origin", header: "From" },
            { key: "requirements", header: "Requirements" },
            { key: "bugs", header: "Past bugs" },
            { key: "error", header: "Error" },
            { key: "duration", header: "Seconds", width: 10 },
          ],
          rows: tests.map((x) => ({ ...x, result: label(x.status), origin: originLabel(x.origin) })),
        },
        {
          name: "Screens",
          columns: [
            { key: "name", header: "Screen", width: 28 },
            { key: "activity", header: "Activity", width: 40 },
            { key: "reach", header: "How to reach it" },
            { key: "ids", header: "Element ids" },
            { key: "notes", header: "Notes" },
          ],
          rows: (report.screens ?? []).map((x) => ({ ...x })),
        },
      ],
      `autotest-${report.house}-${report.app?.version ?? "unknown"}-${report.run_id}`,
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Auto-test: ${report.app?.name ?? report.house}`}
        subtitle={
          <span suppressHydrationWarning>
            {report.app?.version ? `v${report.app.version}` : "version unknown"}
            {report.app?.installed && report.app.installed !== report.app.version
              ? ` (phone had ${report.app.installed})`
              : ""}
            {" · "}
            {fmtDateTime(report.finished ?? createdAt)} · {report.runner ?? "runner"} · run {report.run_id}
          </span>
        }
        actions={
          <>
            <Link href={`/projects/${projectId}/automation`} className="text-sm text-slate-500 hover:underline">
              ← Automation
            </Link>
            {excel && (
              <a
                href={excel.url}
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-grid-head"
              >
                Download run workbook
              </a>
            )}
            <Button onClick={exportReport}>Export report (.xlsx)</Button>
          </>
        }
      />

      {report.status === "partial" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Partial report. {report.partial_reason}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Tests passed" value={`${t.passed ?? 0}/${t.total ?? 0}`} tone={failed ? "red" : "green"}
          hint={failed ? `${failed} failed` : undefined} />
        <Stat label="Requirements passed" value={rq.total ? `${rq.passed ?? 0}/${rq.total}` : "—"}
          tone={rq.failed ? "red" : rq.total ? "green" : undefined}
          hint={rq.total ? `${rq.failed ?? 0} failed, ${(rq.not_covered ?? 0) + (rq.not_testable ?? 0)} not tested` : "none added"} />
        <Stat label="Past bugs found here" value={pb.present ?? 0} tone={pb.present ? "red" : "green"}
          hint={`${pb.not_present ?? 0} checked, not present`} />
        <Stat label="Findings" value={s.findings?.total ?? 0} tone={s.findings?.total ? "amber" : "green"}
          hint={`${s.findings?.app_bugs ?? 0} app bugs`} />
        <Stat label="Screens mapped" value={s.screens ?? 0} />
        <Stat label="Spend" value={`$${(s.cost_usd ?? 0).toFixed(2)}`} hint={`cap $${(s.budget_usd ?? 0).toFixed(0)}`} />
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-700">What it learned from</h2>
        <p className="mt-1 text-sm text-slate-600">
          {(lf.knowledge?.common ?? 0) + (lf.knowledge?.this_app ?? 0) + sum(lf.knowledge?.other_apps)} learnings
          {others.length ? ` (including ${others.length} other app${others.length > 1 ? "s" : ""}: ${others.join(", ")})` : ""},{" "}
          {lf.screens?.screens ?? 0} mapped screens, {lf.verified_tests ?? 0} tests verified on other apps,{" "}
          {lf.recordings ?? 0} recorded flows, {lf.bugs?.distinct ?? 0} past bugs ({lf.bugs?.this_app ?? 0} on this app) and{" "}
          {lf.requirements ?? 0} client requirements.
        </p>
        {!!report.context_errors?.length && (
          <p className="mt-1 text-xs text-amber-700">Not available during the run: {report.context_errors.join("; ")}</p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-700">Findings ({findings.length})</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Nothing here is a bug until someone files it. Check the evidence, edit the text, then file it: it lands in this
          project&apos;s bugs under v{report.app?.version ?? "?"}, with the screenshot attached.
        </p>
        {findings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No findings.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {findings.map((f, i) => (
              <FindingItem key={i} index={i} f={f} projectId={projectId} reportId={reportId}
                shot={f.shot ? links[f.shot] : undefined} canFile={canCreateBugs(role)} version={report.app?.version} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-700">Client requirements ({requirements.length})</h2>
        {requirements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No requirements were known for this app when it ran. Add a requirements document on the Requirements page.
          </p>
        ) : (
          <Table
            head={["Result", "Requirement", "Severity", "Notes"]}
            rows={requirements.map((r) => [
              <ResultBadge key="s" status={r.status} />,
              <span key="t">
                <code className="text-xs text-slate-400">{r.id}</code> {r.title}
                {r.source === "draft" && <Badge tone="amber" className="ml-1">draft</Badge>}
              </span>,
              r.severity ?? "",
              <span key="n" className="text-slate-500">
                {r.note}
                {r.tests.length ? <span className="block text-xs text-slate-400">{r.tests.join(", ")}</span> : null}
              </span>,
            ])}
          />
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Past bugs re-checked on this app</h2>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="checkbox" checked={showUnchecked} onChange={(e) => setShowUnchecked(e.target.checked)} />
            show the {pb.not_checked ?? 0} not checked
          </label>
        </div>
        <Table
          head={["On this app", "Bug", "Seen on", "Notes"]}
          rows={pastBugs
            .filter((b) => showUnchecked || b.status !== "not_checked")
            .map((b) => [
              <ResultBadge key="s" status={b.status} />,
              <span key="t">
                <code className="text-xs text-slate-400">{b.id}</code> {b.title}
                {b.severity && <span className="ml-1 text-xs text-slate-400">({b.severity})</span>}
              </span>,
              <span key="a" className="text-slate-500">{(b.apps ?? []).join(", ")}</span>,
              <span key="n" className="text-slate-500">{b.note}</span>,
            ])}
          empty="No past bug was checked."
        />
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-700">Tests ({tests.length})</h2>
        <Table
          head={["Result", "Test", "From", "Covers"]}
          rows={tests.map((x) => [
            <ResultBadge key="s" status={x.status} />,
            <div key="t">
              <button onClick={() => setOpenTest(openTest === x.nodeid ? null : x.nodeid)} className="text-left font-medium text-slate-800 hover:underline">
                {x.title}
              </button>
              <div className="text-xs text-slate-400">{x.nodeid}</div>
              {openTest === x.nodeid && (
                <div className="mt-1 space-y-1 text-xs text-slate-600">
                  {x.description && <p>{x.description}</p>}
                  {!!x.steps?.length && (
                    <ol className="list-decimal pl-4">
                      {x.steps.map((st, i) => <li key={i}>{st}</li>)}
                    </ol>
                  )}
                  {x.error && <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-red-800">{x.error}</pre>}
                  {x.shot && links[x.shot] && (
                    <a href={links[x.shot]} target="_blank" rel="noreferrer" className="text-brand hover:underline">screenshot ↗</a>
                  )}
                </div>
              )}
            </div>,
            originLabel(x.origin),
            <span key="c" className="text-xs text-slate-500">
              {[...(x.requirements ?? []).map((r) => `req ${r}`), ...(x.bugs ?? []).map((b) => `bug ${b}`)].join(", ")}
            </span>,
          ])}
          empty="No test ran."
        />
      </Card>

      {!!report.screens?.length && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-700">Screens explored ({report.screens.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">This map is saved on the runner, and the next app&apos;s auto-test starts from it.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {report.screens.map((sc) => (
              <li key={sc.name} className="rounded border border-grid-line p-2 text-sm">
                <div className="font-medium text-slate-800">{sc.name}</div>
                {sc.reach && <div className="text-xs text-slate-500">How to reach it: {sc.reach}</div>}
                {!!sc.ids?.length && <div className="mt-0.5 text-xs text-slate-400">{sc.ids.slice(0, 14).join(", ")}</div>}
                {sc.notes && <div className="mt-0.5 text-xs text-amber-700">{sc.notes}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(!!report.learned?.length || report.claude_summary) && (
        <Card className="p-4">
          {!!report.learned?.length && (
            <>
              <h2 className="text-sm font-semibold text-slate-700">Learned by this run</h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                {report.learned.map((l, i) => (
                  <li key={i}>
                    <Badge tone={l.scope === "common" ? "blue" : "violet"} className="mr-1">{l.scope}</Badge>
                    {l.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.claude_summary && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Claude&apos;s summary</summary>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{report.claude_summary}</pre>
            </details>
          )}
        </Card>
      )}
    </div>
  );
}

function originLabel(o?: string) {
  return o === "auto"
    ? "this auto-test"
    : o === "shared"
      ? "shared suite"
      : o === "existing" || o === "approved"
        ? "existing test"
        : o ?? "";
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="mt-2 text-sm text-slate-500">{empty ?? "Nothing to show."}</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-grid-line text-left text-xs text-slate-500">
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-grid-line/60 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingItem({
  index,
  f,
  projectId,
  reportId,
  shot,
  canFile,
  version,
}: {
  index: number;
  f: ReportFinding;
  projectId: string;
  reportId: string;
  shot?: string;
  canFile: boolean;
  version?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(f.title.replace(/^Failed: /, ""));
  const [severity, setSeverity] = useState(SEVERITIES.includes(f.severity ?? "") ? f.severity! : "minor");
  // Frontend / backend (migration 0041): from the test's path, else suggested from what it saw.
  const roleCats = useRoleCategories();
  const [area, setArea] = useState<string>(() => {
    const fromTest = areaFromTestKey(f.test);
    return (
      (isArea(roleCats, fromTest) ? fromTest : null) ??
      suggestArea(`${f.title} ${f.detail ?? ""} ${f.error ?? ""} ${(f.steps ?? []).join(" ")}`, roleCats)?.area ??
      ""
    );
  });
  const [description, setDescription] = useState(
    [f.detail, f.error ? `What the test saw:\n${f.error}` : "", f.test ? `Found by the auto-test: ${f.test}` : ""]
      .filter(Boolean)
      .join("\n\n"),
  );
  const [steps, setSteps] = useState((f.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n"));

  async function file() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/projects/${projectId}/reports/${reportId}/file-bug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finding: index, title, severity, area: area || null, description, steps_to_reproduce: steps }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(body.error ?? `Failed (${res.status})`);
    setOpen(false);
    router.refresh();
  }

  return (
    <li className="rounded-md border border-grid-line p-3">
      <div className="flex flex-wrap items-start gap-3">
        {shot && (
          <a href={shot} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot} alt="Screenshot when the check failed" className="h-32 w-auto rounded border border-grid-line" />
          </a>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <ResultBadge status={f.type} />
            {f.severity && <span className="text-xs text-slate-500">{f.severity}</span>}
            <span className="font-medium text-slate-800">{f.title}</span>
          </div>
          {f.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{f.detail}</p>}
          {f.error && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-500">What the test saw</summary>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-800">{f.error}</pre>
            </details>
          )}
          {f.test && <div className="mt-1 text-xs text-slate-400">{f.test}</div>}
          <div className="mt-2">
            {f.bug_id ? (
              <Link href={`/projects/${projectId}/bugs?focus=${f.bug_id}`} className="text-sm font-medium text-brand hover:underline">
                ✓ Filed as a bug: open it →
              </Link>
            ) : canFile ? (
              !open && (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  File as bug…
                </Button>
              )
            ) : null}
          </div>
          {open && !f.bug_id && (
            <div className="mt-2 space-y-2 rounded-md bg-grid-head/40 p-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="text-slate-600">Severity</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
                  {SEVERITIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <label className="text-slate-600">Category</label>
                <select value={area} onChange={(e) => setArea(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
                  <option value="">Not set</option>
                  {roleCats.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">filed under v{version ?? "?"}</span>
              </div>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Description" />
              <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" placeholder="Steps to reproduce" />
              {err && <p className="text-sm text-red-700">{err}</p>}
              <div className="flex gap-2">
                <Button onClick={file} disabled={busy || !title.trim()}>{busy ? "Filing…" : "File bug"}</Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
