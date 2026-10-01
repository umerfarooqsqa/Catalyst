"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { fmtDateTime, initials } from "@/lib/format";
import { isAdmin, isStaff } from "@/lib/permissions";
import type { RoleLevel } from "@/lib/types/models";

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  author_id: string | null;
  author: { full_name: string; roles: { label: string } | null } | null;
};

/**
 * The comment thread of a bug.
 * - Live: new, edited and deleted comments appear without reloading (realtime, migration 0034).
 * - Authors can edit and delete their own comments. An admin can delete any comment.
 *   An edited comment says so.
 * - Anyone on staff (QA, developers, admins) can comment. Viewers read only.
 * - Ctrl/⌘+Enter posts.
 * RLS decides the same rules (0002 + 0034); this only mirrors them.
 */
export default function BugComments({
  bugId,
  userId,
  role,
  refreshKey = 0,
}: {
  bugId: string;
  userId: string;
  role: RoleLevel;
  /** Bump to reload after the drawer itself posted a comment (e.g. a fix note). */
  refreshKey?: number;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("comments")
      .select("id, content, created_at, edited_at, author_id, author:profiles(full_name, roles(label))")
      .eq("bug_id", bugId)
      .order("created_at", { ascending: true });
    if (error) setErr(error.message);
    setComments((data as unknown as CommentRow[]) ?? []);
    setLoaded(true);
  }, [bugId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bug-comments-${bugId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `bug_id=eq.${bugId}` },
        () => load(),
      )
      // A delete event carries only the id (no bug_id), so the filter above can't match it.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, (p) => {
        const id = (p.old as { id?: string })?.id;
        if (id) setComments((cs) => cs.filter((c) => c.id !== id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bugId, load]);

  async function post() {
    const content = draft.trim();
    if (!content) return;
    setErr(null);
    setPosting(true);
    const { error } = await createClient().from("comments").insert({ bug_id: bugId, author_id: userId, content });
    setPosting(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDraft("");
    await load();
    endRef.current?.scrollIntoView({ block: "nearest" });
  }

  async function saveEdit(id: string) {
    const content = editText.trim();
    if (!content) return;
    setErr(null);
    const { error } = await createClient().from("comments").update({ content }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this comment?")) return;
    setErr(null);
    const { error } = await createClient().from("comments").delete().eq("id", id);
    if (error) setErr(error.message);
    else setComments((cs) => cs.filter((c) => c.id !== id));
  }

  const onKey = (submit: () => void) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        Comments{comments.length ? ` (${comments.length})` : ""}
      </h3>
      <ul className="space-y-3">
        {comments.map((c) => {
          const mine = !!c.author_id && c.author_id === userId;
          return (
            <li key={c.id} className="group flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                {initials(c.author?.full_name ?? "?")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{c.author?.full_name ?? "Former user"}</span>
                  {c.author?.roles?.label && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{c.author.roles.label}</span>
                  )}
                  {" · "}
                  <span suppressHydrationWarning>{fmtDateTime(c.created_at)}</span>
                  {c.edited_at && (
                    <span className="text-slate-400" title={`Edited ${fmtDateTime(c.edited_at)}`} suppressHydrationWarning>
                      {" "}
                      · edited
                    </span>
                  )}
                  {editing !== c.id && (mine || isAdmin(role)) && (
                    <span className="ml-2 opacity-0 transition group-hover:opacity-100 max-sm:opacity-100">
                      {mine && (
                        <button
                          onClick={() => {
                            setEditing(c.id);
                            setEditText(c.content);
                          }}
                          className="text-brand hover:underline"
                        >
                          Edit
                        </button>
                      )}
                      <button onClick={() => remove(c.id)} className="ml-2 text-red-600 hover:underline">
                        Delete
                      </button>
                    </span>
                  )}
                </p>
                {editing === c.id ? (
                  <div className="mt-1">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={onKey(() => saveEdit(c.id))}
                      rows={3}
                      autoFocus
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="mt-1 flex gap-2">
                      <Button variant="secondary" onClick={() => saveEdit(c.id)} disabled={!editText.trim()}>
                        Save
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.content}</p>
                )}
              </div>
            </li>
          );
        })}
        {loaded && comments.length === 0 && <li className="text-sm text-slate-400">No comments yet</li>}
        <li ref={endRef} aria-hidden />
      </ul>
      {isStaff(role) ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey(post)}
            rows={3}
            placeholder="Write a comment… (Ctrl+Enter to post)"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <Button variant="secondary" className="mt-1" onClick={post} disabled={!draft.trim() || posting}>
            {posting ? "Posting…" : "Comment"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Viewers can read comments but not post.</p>
      )}
      {err && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}
