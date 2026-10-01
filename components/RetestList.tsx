"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Badge, EmptyState } from "@/components/ui";
import VersionChip from "@/components/VersionChip";
import { canEditBug } from "@/lib/permissions";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, titleCase } from "@/lib/format";
import type { BugWithJoins, RoleLevel } from "@/lib/types/models";

/**
 * The retest queue: bugs marked "fixed" (not yet explicitly flagged ready)
 * and "ready_for_retest" both land here -- either status means "needs a
 * retest," whether or not someone remembered to flip it to ready first.
 * The Status column distinguishes the two.
 *
 * Its own quick action: close a bug directly from this list
 * (spreadsheet-style, one click) once you've confirmed the fix, instead of
 * opening the full bug drawer just to change one dropdown. "Reopen" isn't
 * offered here -- that's still a drawer action, since a failed retest
 * usually needs a comment explaining why, not just a status flip.
 */
export default function RetestList({
  projectId,
  bugs,
  role,
  userId,
}: {
  projectId: string;
  bugs: BugWithJoins[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const [closing, setClosing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function closeBug(id: string) {
    setErr(null);
    setClosing(id);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({ status: "closed" as never })
      .eq("id", id);
    if (error) setErr(error.message);
    setClosing(null);
    router.refresh();
  }

  return (
    <Card className="mt-6 overflow-x-auto">
      {err && <p className="p-3 text-xs text-red-600">{err}</p>}
      {bugs.length === 0 ? (
        <div className="p-4">
          <EmptyState title="Nothing waiting on a retest">
            Bugs land here automatically once they&apos;re marked &ldquo;fixed&rdquo;
            or &ldquo;ready for retest&rdquo; from the bug drawer.
          </EmptyState>
        </div>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="border-b border-grid-line bg-grid-head text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Bug</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Severity</th>
              <th className="px-3 py-2 text-left font-medium">Category</th>
              <th className="px-3 py-2 text-left font-medium">Assignee</th>
              <th className="px-3 py-2 text-left font-medium">Last updated</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-grid-line">
            {bugs.map((b) => {
              const canClose = canEditBug(role, userId, b);
              return (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {b.title}{" "}
                    <VersionChip
                      version={b.release?.version}
                      confirmedAt={b.version_confirmed_at}
                      confirmedBy={b.confirmer?.full_name}
                      showMissing
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={b.status === "ready_for_retest" ? "blue" : "slate"}>
                      {titleCase(b.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={b.severity === "critical" ? "red" : b.severity === "major" ? "amber" : "slate"}>
                      {SEVERITY_LABELS[b.severity]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{b.category?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{b.assignee?.full_name ?? "Unassigned"}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtDateTime(b.updated_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {canClose && (
                        <button
                          type="button"
                          onClick={() => closeBug(b.id)}
                          disabled={closing === b.id}
                          className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                        >
                          {closing === b.id ? "Closing…" : "Close"}
                        </button>
                      )}
                      <Link
                        href={`/projects/${projectId}/bugs?focus=${b.id}`}
                        className="text-xs font-medium text-brand-fg hover:underline"
                      >
                        Open &rarr;
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
