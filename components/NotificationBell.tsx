"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fmtRelative } from "@/lib/format";
import type { Notification } from "@/lib/types/models";

export default function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15);
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("notif-bell")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          load();
          // In-app cue for a fresh notification while the tab is open.
          // (Closed-app alerts with sound come from the push service worker.)
          if (
            payload.eventType === "INSERT" &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible" &&
            typeof navigator !== "undefined" &&
            typeof navigator.vibrate === "function"
          ) {
            navigator.vibrate([120, 60, 120]);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unread = items.filter((i) => !i.is_read).length;

  async function markAllRead() {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false);
    load();
  }

  function hrefFor(n: Notification): string {
    // the bug or task itself, opened in its project (app/(app)/bugs/[bugId], app/(app)/tasks/[taskId])
    if (n.related_bug_id) return `/bugs/${n.related_bug_id}`;
    if (n.related_task_id) return `/tasks/${n.related_task_id}`;
    return "/notifications";
  }

  async function openItem(n: Notification) {
    setOpen(false);
    if (n.is_read) return;
    setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    await createClient().from("notifications").update({ is_read: true }).eq("id", n.id);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-grid-head"
        aria-label="Notifications"
      >
        Notifications
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-grid-line bg-white shadow-popover">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              <button
                onClick={markAllRead}
                className="text-xs text-brand hover:underline"
              >
                Mark all read
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">
                  Nothing yet
                </p>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={hrefFor(n)}
                    onClick={() => openItem(n)}
                    className={`block border-b border-slate-50 px-3 py-2 text-sm hover:bg-grid-head ${
                      n.is_read ? "text-slate-500" : "text-slate-800"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      )}
                      <div>
                        <p>{n.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400" suppressHydrationWarning>
                          {fmtRelative(n.created_at)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-slate-100 px-3 py-2 text-center text-xs text-brand hover:underline"
            >
              View all
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

