"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import TeamWorkload, { type WorkItem } from "@/components/TeamWorkload";
import TeamActivityHeatmap from "@/components/TeamActivityHeatmap";

/**
 * The dashboard's team section (QA/admin): "Team workload" (who has completed how much, and what
 * is still open) and "Activity over time" (the 0053 heatmap, fetched only when its tab opens).
 */
export default function TeamSection({ items }: { items: WorkItem[] }) {
  const [tab, setTab] = useState<"workload" | "activity">("workload");
  const tabCls = (on: boolean) =>
    cx(
      "-mb-px border-b-2 px-3 py-1.5 text-sm",
      on ? "border-slate-800 font-semibold text-slate-800" : "border-transparent text-slate-500 hover:text-slate-700",
    );
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-end gap-1 border-b border-grid-line" role="tablist">
        <button role="tab" aria-selected={tab === "workload"} className={tabCls(tab === "workload")} onClick={() => setTab("workload")}>
          Team workload
        </button>
        <button role="tab" aria-selected={tab === "activity"} className={tabCls(tab === "activity")} onClick={() => setTab("activity")}>
          Activity over time
        </button>
      </div>
      {tab === "workload" ? <TeamWorkload items={items} /> : <TeamActivityHeatmap embedded />}
    </section>
  );
}
