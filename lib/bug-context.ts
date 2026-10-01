import type { SupabaseClient } from "@supabase/supabase-js";
import { PHONE_HELPER_URL } from "@/lib/phone-screenshot";

/**
 * "Watch and learn where bugs are": right after a bug is logged (or from the
 * bug drawer), ask the aktrade Control Center on this PC what is on the test
 * phone. It captures the app screen (activity, key elements, screenshot) and
 * the path the tester took (their Guide-portal recording), and stores it so
 * automation learns "this bug is on this screen, reached like this"
 * (aktrade utils/bug_context.py). The portal then attaches the screenshot and a
 * "where it happens" note to the bug.
 *
 * Nothing is captured when the app under test isn't on screen.
 */
export type BugContext = {
  ok: boolean;
  error?: string;
  summary?: string;
  context?: { screen: string; path: { text: string }[] } | null;
  screenshot_b64?: string;
  screenshot_type?: string;
};

export async function captureBugContext(house: string, bugId: string, title: string): Promise<BugContext> {
  try {
    const res = await fetch(`${PHONE_HELPER_URL}/adb/bug-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ house, bug_id: bugId, title }),
      cache: "no-store",
    });
    return (await res.json()) as BugContext;
  } catch {
    return {
      ok: false,
      error: "Can't reach the aktrade Control Center on this PC (python web_dashboard.py), so the phone's screen wasn't attached.",
    };
  }
}

/** Uploads the captured screenshot and "where it happens" note as attachments of the bug. */
export async function attachBugContext(
  supabase: SupabaseClient,
  bugId: string,
  userId: string,
  ctx: BugContext,
): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const files: File[] = [];
  if (ctx.screenshot_b64) {
    const bin = Uint8Array.from(atob(ctx.screenshot_b64), (c) => c.charCodeAt(0));
    const type = ctx.screenshot_type || "image/jpeg";
    files.push(new File([bin], `where-it-happens-${stamp}.${type === "image/png" ? "png" : "jpg"}`, { type }));
  }
  if (ctx.summary) files.push(new File([ctx.summary], `where-it-happens-${stamp}.md`, { type: "text/markdown" }));
  for (const file of files) {
    const path = `${bugId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
    if (upErr) return upErr.message;
    const { error } = await supabase.from("attachments").insert({
      bug_id: bugId,
      file_path: path,
      file_name: file.name,
      file_size_bytes: file.size,
      uploaded_by: userId,
    });
    if (error) return error.message;
  }
  return null;
}

/** The captured path as numbered steps, for an empty "Steps to reproduce". */
export function pathAsSteps(ctx: BugContext): string {
  const path = ctx.context?.path ?? [];
  if (!path.length) return "";
  return (
    path.map((p, i) => `${i + 1}. ${p.text}`).join("\n") +
    `\n(Screen: ${ctx.context?.screen}. Path captured from the test phone when the bug was logged.)`
  );
}
