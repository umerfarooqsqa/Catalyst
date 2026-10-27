"use client";

import { useCallback, useEffect, useState } from "react";
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

  // live, and caught up after the page slept (it was rendered once and never refreshed)
  const reload = useCallback(async () => {
    const { data } = await createClient()
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) setItems(data);
  }, []);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notif-list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => reload())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") reload();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reload);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reload);
    };
  }, [reload]);

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
    // the bug or task itself, opened in its project (app/(app)/bugs/[bugId], app/(app)/tasks/[taskId])
    if (n.related_bug_id) return `/bugs/${n.related_bug_id}`;
    if (n.related_task_id) return `/tasks/${n.related_task_id}`;
    if (n.related_warning_id) return `/my-queue#w-${n.related_warning_id}`; // app warning card (0056)
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
                <Link
                  href={href(n)}
                  onClick={() => !n.is_read && markRead(n.id, true)}
                  className="text-sm text-slate-800 hover:text-brand"
                >
                  {n.message}
                </Link>
                <p className="mt-0.5 text-xs text-slate-400" suppressHydrationWarning>
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

