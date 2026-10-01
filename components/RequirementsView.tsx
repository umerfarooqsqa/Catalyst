"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Badge, cx } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { canManageRequirements } from "@/lib/permissions";
import {
  REQUIREMENT_STATUSES,
  TEST_CASE_STATUSES,
} from "@/lib/types/models";
import type { RoleLevel } from "@/lib/types/models";

type TC = {
  id: string;
  title: string;
  steps: string | null;
  expected_result: string | null;
  status: string;
};
type BugLite = {
  id: string;
  title: string;
  severity: string;
  status: string;
};
type Req = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  test_cases: TC[];
  bugs: BugLite[];
};

export default function RequirementsView({
  projectId,
  requirements,
  role,
  userId,
}: {
  projectId: string;
  requirements: Req[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const canEdit = canManageRequirements(role);
  const [open, setOpen] = useState<Set<string>>(
    new Set(requirements.map((r) => r.id)),
  );
  const [err, setErr] = useState<string | null>(null);
  const [showNewReq, setShowNewReq] = useState(false);
  const [nrTitle, setNrTitle] = useState("");
  const [nrDesc, setNrDesc] = useState("");
  const [tcFor, setTcFor] = useState<string | null>(null);
  const [tcTitle, setTcTitle] = useState("");
  const [tcSteps, setTcSteps] = useState("");
  const [tcExpected, setTcExpected] = useState("");

  const supabase = createClient();
  const refresh = () => router.refresh();

  async function addRequirement(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("requirements").insert({
      project_id: projectId,
      title: nrTitle.trim(),
      description: nrDesc.trim() || null,
      created_by: userId,
    });
    if (error) return setErr(error.message);
    setNrTitle("");
    setNrDesc("");
    setShowNewReq(false);
    refresh();
  }

  async function setReqStatus(id: string, status: string) {
    const { error } = await supabase
      .from("requirements")
      .update({ status: status as never })
      .eq("id", id);
    if (error) setErr(error.message);
    else refresh();
  }

  async function addTestCase(e: React.FormEvent) {
    e.preventDefault();
    if (!tcFor) return;
    const { error } = await supabase.from("test_cases").insert({
      requirement_id: tcFor,
      title: tcTitle.trim(),
      steps: tcSteps.trim() || null,
      expected_result: tcExpected.trim() || null,
      created_by: userId,
    });
    if (error) return setErr(error.message);
    setTcTitle("");
    setTcSteps("");
    setTcExpected("");
    setTcFor(null);
    refresh();
  }

  async function setTcStatus(id: string, status: string) {
    const { error } = await supabase
      .from("test_cases")
      .update({ status: status as never })
      .eq("id", id);
    if (error) setErr(error.message);
    else refresh();
  }

  const tcTone = (s: string) =>
    s === "pass" ? "green" : s === "fail" ? "red" : "slate";

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Requirement → test case → bug traceability. {requirements.length}{" "}
          requirement(s).
        </p>
        {canEdit && (
          <Button
            onClick={() => setShowNewReq((s) => !s)}
            className="w-full justify-center py-2 sm:w-auto"
          >
            + New requirement
          </Button>
        )}
      </div>

      {err && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </p>
      )}

      {showNewReq && (
        <Card className="mb-4 p-4">
          <form onSubmit={addRequirement} className="space-y-2.5">
            <input
              placeholder="Requirement title (e.g. REQ-3: …)"
              required
              autoFocus
              value={nrTitle}
              onChange={(e) => setNrTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <textarea
              placeholder="Description"
              rows={3}
              value={nrDesc}
              onChange={(e) => setNrDesc(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!nrTitle.trim()}
                className="flex-1 justify-center py-2 sm:flex-none"
              >
                Save requirement
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewReq(false)}
                className="py-2"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {requirements.map((r) => {
          const isOpen = open.has(r.id);
          const passed = r.test_cases.filter((t) => t.status === "pass").length;
          return (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex items-start justify-between gap-2 p-3 sm:p-4">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                      return n;
                    })
                  }
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-slate-400">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <h3 className="min-w-0 font-semibold text-slate-800">
                      {r.title}
                    </h3>
                    <Badge tone={r.status === "active" ? "green" : "slate"}>
                      {titleCase(r.status)}
                    </Badge>
                  </div>
                  {r.description && (
                    <p className="mt-1 pl-5 text-sm text-slate-500">
                      {r.description}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
                    <span className="rounded-md bg-grid-head px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {r.test_cases.length} test
                      {r.test_cases.length === 1 ? "" : "s"}
                    </span>
                    <span
                      className={cx(
                        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        r.test_cases.length > 0 &&
                          passed === r.test_cases.length
                          ? "bg-brand-soft text-brand-fg"
                          : "bg-grid-head text-slate-600",
                      )}
                    >
                      {passed}/{r.test_cases.length} passing
                    </span>
                    {r.bugs.length > 0 && (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                        {r.bugs.length} bug{r.bugs.length === 1 ? "" : "s"} filed
                      </span>
                    )}
                  </div>
                </button>
                {canEdit && (
                  <select
                    value={r.status}
                    onChange={(e) => setReqStatus(r.id, e.target.value)}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    {REQUIREMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-3 sm:p-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Test cases
                        </h4>
                        {canEdit && (
                          <button
                            onClick={() =>
                              setTcFor(tcFor === r.id ? null : r.id)
                            }
                            className="text-xs text-brand hover:underline"
                          >
                            + add
                          </button>
                        )}
                      </div>
                      {tcFor === r.id && (
                        <form
                          onSubmit={addTestCase}
                          className="mb-2 space-y-2 rounded-md border border-slate-200 bg-white p-2.5"
                        >
                          <input
                            placeholder="Test case title"
                            required
                            autoFocus
                            value={tcTitle}
                            onChange={(e) => setTcTitle(e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                          />
                          <textarea
                            placeholder="Steps"
                            rows={2}
                            value={tcSteps}
                            onChange={(e) => setTcSteps(e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-xs outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                          />
                          <input
                            placeholder="Expected result"
                            value={tcExpected}
                            onChange={(e) => setTcExpected(e.target.value)}
                            className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="submit"
                              disabled={!tcTitle.trim()}
                              className="flex-1 justify-center py-2 sm:flex-none"
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setTcFor(null)}
                              className="py-2"
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      )}
                      <ul className="space-y-1.5">
                        {r.test_cases.map((t) => (
                          <li
                            key={t.id}
                            className="rounded-md border border-slate-200 bg-white p-2.5 text-sm"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-medium text-slate-700">
                                  {t.title}
                                </p>
                                {t.expected_result && (
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    Expected: {t.expected_result}
                                  </p>
                                )}
                              </div>
                              {canEdit ? (
                                <select
                                  value={t.status}
                                  onChange={(e) =>
                                    setTcStatus(t.id, e.target.value)
                                  }
                                  className={cx(
                                    "w-full shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium sm:w-auto",
                                    t.status === "pass"
                                      ? "border-green-300 text-green-700"
                                      : t.status === "fail"
                                        ? "border-red-300 text-red-700"
                                        : "border-slate-300 text-slate-600",
                                  )}
                                >
                                  {TEST_CASE_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {titleCase(s)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <Badge tone={tcTone(t.status)}>
                                  {titleCase(t.status)}
                                </Badge>
                              )}
                            </div>
                          </li>
                        ))}
                        {r.test_cases.length === 0 && (
                          <li className="text-xs text-slate-400">
                            No test cases yet.
                          </li>
                        )}
                      </ul>
                    </div>

                    <div>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Bugs filed against this requirement
                      </h4>
                      <ul className="space-y-1">
                        {r.bugs.map((b) => (
                          <li key={b.id}>
                            <Link
                              href={`/projects/${projectId}/bugs?focus=${b.id}`}
                              className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm hover:bg-slate-100"
                            >
                              <span className="min-w-0 truncate">{b.title}</span>
                              <span className="flex shrink-0 gap-1">
                                <Badge
                                  tone={
                                    b.severity === "critical"
                                      ? "red"
                                      : b.severity === "major"
                                        ? "amber"
                                        : "slate"
                                  }
                                >
                                  {titleCase(b.severity)}
                                </Badge>
                                <Badge tone="blue">
                                  {titleCase(b.status)}
                                </Badge>
                              </span>
                            </Link>
                          </li>
                        ))}
                        {r.bugs.length === 0 && (
                          <li className="text-xs text-slate-400">
                            No bugs filed.
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {requirements.length === 0 && (
          <Card className="p-8 text-center text-sm text-slate-500">
            No requirements yet.
            {canEdit ? " Add the first one above." : ""}
          </Card>
        )}
      </div>
    </div>
  );
}
