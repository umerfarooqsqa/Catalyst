"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, cx } from "@/components/ui";
import { fmtDateTime, titleCase } from "@/lib/format";
import type { Notification } from "@/lib/types/models";

const TONE: Record<string, "slate" | "blue" | "green" | "amber" | "red" | "violet"> =
  {
    assignment: "blue",
    status_change: "violet",
    comment: "slate",
    retest_ready: "green",
  };

export default function NotificationList({
  initial,
}: {
  initial: Notification[];
}) {
  const [items, setItems] = useState(initial);

  async function markRead(id: string, is_read: boolean) {
    const supabase = createClient();
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, is_read } : x)));
    await supabase.from("notifications").update({ is_read }).eq("id", id);
  }

  async function markAll() {
    const supabase = createClient();
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false);
  }

  function href(n: Notification) {
    if (n.related_bug_id) return `/my-queue?bug=${n.related_bug_id}`;
    if (n.related_task_id) return `/my-queue?task=${n.related_task_id}`;
    return "#";
  }

  return (
    <div>
      <div className="mb-3">
        <Button variant="secondary" onClick={markAll}>
          Mark all read
        </Button>
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-sm border border-grid-line bg-white">
        {items.map((n) => (
          <div
            key={n.id}
            className={cx(
              "flex items-start justify-between gap-3 px-4 py-3",
              !n.is_read && "bg-brand/5",
            )}
          >
            <div className="flex items-start gap-3">
              <Badge tone={TONE[n.type] ?? "slate"}>
                {titleCase(n.type)}
              </Badge>
              <div>
                <Link href={href(n)} className="text-sm text-slate-800 hover:text-brand">
                  {n.message}
                </Link>
                <p className="mt-0.5 text-xs text-slate-400">
                  {fmtDateTime(n.created_at)}
                </p>
              </div>
            </div>
            <button
              onClick={() => markRead(n.id, !n.is_read)}
              className="shrink-0 text-xs text-slate-400 hover:text-brand"
            >
              {n.is_read ? "mark unread" : "mark read"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

