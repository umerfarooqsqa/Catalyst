"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Badge } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { canEditBug, developerStatusTargets, isManager, isStaff } from "@/lib/permissions";
import type {
  ReleaseOption,
  BugWithJoins,
  MemberOption,
  RoleLevel,
} from "@/lib/types/models";
import { BUG_STATUSES } from "@/lib/types/models";
import { fmtDateTime, titleCase } from "@/lib/format";
import { capturePhone, listPhones, type Phone } from "@/lib/phone-screenshot";
import { attachBugContext, captureBugContext } from "@/lib/bug-context";
import BugComments from "@/components/BugComments";
import AttachmentGallery from "@/components/AttachmentGallery";
import { usePhoneHelper } from "@/lib/phone-helper-available";
import AreaChip from "@/components/AreaChip";
import AssigneeOptions from "@/components/AssigneeOptions";
import { areaPatch, categoryOf, isArea, suggestArea } from "@/lib/bug-area";
import { useRoleCategories } from "@/components/RoleCategories";
import type { AreaDevelopers, BugArea } from "@/lib/bug-area";
import type { BugCategory } from "@/lib/types/models";

type AttachmentRow = {
  id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
};

export default function BugDrawer({
  bug,
  role,
  userId,
  assignable,
  releases = [],
  siblingProject,
  categories = [],
  projectDevelopers,
  onClose,
  onChanged,
}: {
  bug: BugWithJoins;
  role: RoleLevel;
  userId: string;
  assignable: MemberOption[];
  /** The project's app versions; the bug's version can be changed among them. */
  releases?: ReleaseOption[];
  siblingProject: { id: string; name: string; platform: string } | null;
  /** For the frontend/backend suggestion (migration 0041). */
  categories?: BugCategory[];
  /** The project's developers by area: changing the area can move the bug to that area's developer. */
  projectDevelopers?: AreaDevelopers;
  onClose: () => void;
  onChanged: () => void;
}) {
  // QA/admin edit everything. Developers only move the status forward (In progress / Fixed)
  // and never see edit, close or delete controls (migration 0034 enforces it too).
  const editable = canEditBug(role, userId, bug);
  const canAssign = isManager(role);
  const devTargets = developerStatusTargets(role, bug.status);
  // The phone-capture buttons need the aktrade Control Center on this PC: hidden on phones / in the app.
  const phoneHelper = usePhoneHelper();
  const [description, setDescription] = useState(bug.description ?? "");
  const [steps, setSteps] = useState(bug.steps_to_reproduce ?? "");
  const [savingText, setSavingText] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [commentsKey, setCommentsKey] = useState(0);
  // Developer "Mark fixed": an optional note for QA (build, commit, what changed), posted as a comment.
  const [fixNoteOpen, setFixNoteOpen] = useState(false);
  const [fixNote, setFixNote] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "Take phone screenshot": busy while capturing/uploading; a list when several phones need a choice.
  const [shotBusy, setShotBusy] = useState(false);
  const [phoneChoice, setPhoneChoice] = useState<Phone[] | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "busy" | "done">("idle");
  // Automation: which machine tests this bug (Android -> Windows, iOS -> Mac)
  // is decided by its project's platform; the job's status is tracked here.
  const [projPlatform, setProjPlatform] = useState<string | null>(null);
  // A project with no house has no app for a runner to test. Sending is still
  // allowed (by decision) but the user is told up front.
  const [hasHouse, setHasHouse] = useState(true);
  // False until the project/job lookup returns, so the box never claims
  // "No platform set" for a project whose platform simply hasn't loaded yet.
  const [autoReady, setAutoReady] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string; note: string | null } | null>(null);
  const [jobBusy, setJobBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: a } = await supabase
      .from("attachments")
      .select("id, file_name, file_path, file_size_bytes, created_at")
      .eq("bug_id", bug.id)
      .order("created_at", { ascending: true });
    setAttachments((a as AttachmentRow[]) ?? []);
  }, [bug.id]);

  const loadAutomation = useCallback(async () => {
    const supabase = createClient();
    const [{ data: proj }, { data: jobs }] = await Promise.all([
      supabase
        .from("projects")
        .select("platform, house_slug, house_group")
        .eq("id", bug.project_id)
        .maybeSingle(),
      supabase
        .from("test_jobs")
        .select("id, status, note")
        .eq("bug_id", bug.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    setProjPlatform(proj?.platform ?? null);
    setHasHouse(!!(proj?.house_slug || proj?.house_group));
    setAutoReady(true);
    setJob(jobs?.[0] ?? null);
  }, [bug.id, bug.project_id]);

  useEffect(() => {
    loadAutomation();
  }, [loadAutomation]);

  async function sendToAutomation() {
    if (!projPlatform) return;
    setErr(null);
    setJobBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("test_jobs").insert({
      project_id: bug.project_id,
      platform: projPlatform,
      kind: "bug",
      bug_id: bug.id,
      created_by: userId,
    });
    setJobBusy(false);
    if (error) {
      setErr(
        error.code === "23505"
          ? "This bug already has an active automation job."
          : error.message,
      );
      return;
    }
    loadAutomation();
  }

  useEffect(() => {
    setDescription(bug.description ?? "");
    setSteps(bug.steps_to_reproduce ?? "");
    load();
  }, [bug.id, bug.description, bug.steps_to_reproduce, load]);

  async function saveText() {
    setSavingText(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({
        description: description.trim() || null,
        steps_to_reproduce: steps.trim() || null,
      })
      .eq("id", bug.id);
    setSavingText(false);
    if (error) setErr(error.message);
    else onChanged();
  }

  async function setStatus(status: string) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({ status: status as never })
      .eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  /** Developer status change; "fixed" can carry a note for QA, posted as a comment. */
  async function developerSetStatus(status: "in_progress" | "fixed", note = "") {
    setErr(null);
    setStatusBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("bugs").update({ status }).eq("id", bug.id);
    if (!error && note.trim()) {
      const { error: cErr } = await supabase
        .from("comments")
        .insert({ bug_id: bug.id, author_id: userId, content: `✅ Marked fixed: ${note.trim()}` });
      if (cErr) setErr(`Marked fixed, but the note was not posted: ${cErr.message}`);
    }
    setStatusBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setFixNoteOpen(false);
    setFixNote("");
    setCommentsKey((k) => k + 1);
    onChanged();
  }

  async function deleteBug() {
    if (!confirm(`Delete "${bug.title}"? This cannot be undone.`)) return;
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("bugs").delete().eq("id", bug.id);
    if (error) {
      setErr(error.message);
      return;
    }
    onClose();
    onChanged();
  }

  async function setRelease(release_id: string | null) {
    setErr(null);
    const { error } = await createClient().from("bugs").update({ release_id }).eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  // The DB trigger (migration 0037) stamps who/when, and clears it if the version changes later.
  async function setVersionConfirmed(confirmed: boolean) {
    setErr(null);
    const { error } = await createClient()
      .from("bugs")
      .update({ version_confirmed_at: confirmed ? new Date().toISOString() : null })
      .eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  // Frontend / backend (migration 0041). An open bug that was auto-routed can follow to the new
  // area's developer (areaPatch); one assigned by hand keeps its assignee.
  const [moveToAreaDev, setMoveToAreaDev] = useState(true);
  const roleCats = useRoleCategories();
  const areaSuggestion = isArea(roleCats, bug.area)
    ? null
    : suggestArea(`${bug.title} ${bug.description ?? ""} ${bug.steps_to_reproduce ?? ""}`, roleCats, categories, bug.category_id);
  async function setArea(area: BugArea | null) {
    setErr(null);
    const patch = projectDevelopers ? areaPatch(bug, area, projectDevelopers, moveToAreaDev) : { area };
    const { error } = await createClient().from("bugs").update(patch).eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  async function setAssignee(assignee_id: string | null) {
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update({ assignee_id })
      .eq("id", bug.id);
    if (error) setErr(error.message);
    else onChanged();
  }

  // Copies this bug's content into the house's other platform project --
  // an independent snapshot (same pattern as copying from the master
  // library: no live link, copied_from_bug_id is informational only).
  // Workflow state (assignee/due_date/status) intentionally does not carry
  // over -- the copy starts fresh as an open bug in the target project.
  async function copyToSibling() {
    if (!siblingProject) return;
    setErr(null);
    setCopyState("busy");
    const supabase = createClient();
    const { error } = await supabase.from("bugs").insert({
      project_id: siblingProject.id,
      title: bug.title,
      description: bug.description,
      steps_to_reproduce: bug.steps_to_reproduce,
      severity: bug.severity,
      priority: bug.priority,
      area: bug.area,
      category_id: bug.category_id,
      copied_from_bug_id: bug.id,
    });
    if (error) {
      setErr(error.message);
      setCopyState("idle");
      return;
    }
    setCopyState("done");
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = "";
  }

  // "📍 Where it happens": capture the app screen + path from the test phone, attach it and let
  // automation learn it (aktrade utils/bug_context.py).
  async function captureWhere() {
    setErr(null);
    setShotBusy(true);
    try {
      const { data: proj } = await createClient()
        .from("projects")
        .select("house_slug, house_group")
        .eq("id", bug.project_id)
        .maybeSingle();
      const house = proj?.house_slug ?? proj?.house_group;
      if (!house) throw new Error("This project has no app linked, so there is no phone screen to capture.");
      const ctx = await captureBugContext(house, bug.id, bug.title);
      if (!ctx.ok) throw new Error(ctx.error || "Capture failed");
      const e = await attachBugContext(createClient(), bug.id, userId, ctx);
      if (e) throw new Error(e);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setShotBusy(false);
    }
  }

  // Captures the connected phone's screen via the aktrade Control Center on this PC
  // (adb screencap) and attaches it to this bug.
  async function takePhoneScreenshot(serial?: string) {
    setErr(null);
    setPhoneChoice(null);
    setShotBusy(true);
    try {
      if (!serial) {
        const phones = await listPhones();
        if (phones.length === 0) {
          throw new Error("No phone connected: plug it in over USB, allow USB debugging, then try again.");
        }
        if (phones.length > 1) {
          setPhoneChoice(phones);
          return;
        }
        serial = phones[0].serial;
      }
      await uploadFile(await capturePhone(serial, bug.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setShotBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setErr(null);
    const supabase = createClient();
    const path = `${bug.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(path, file);
    if (upErr) {
      setErr(upErr.message);
      return;
    }
    const { error } = await supabase.from("attachments").insert({
      bug_id: bug.id,
      file_path: path,
      file_name: file.name,
      file_size_bytes: file.size,
      uploaded_by: userId,
    });
    if (error) setErr(error.message);
    load();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-grid-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-grid-line bg-white px-4 py-3 sm:px-5 sm:py-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  bug.severity === "critical"
                    ? "red"
                    : bug.severity === "major"
                      ? "amber"
                      : "slate"
                }
              >
                {SEVERITY_LABELS[bug.severity]}
              </Badge>
              <AreaChip area={bug.area} showMissing />
              <Badge tone="blue">{titleCase(bug.status)}</Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {bug.title}
            </h2>
            <p className="text-xs text-slate-500">
              {bug.category?.name ?? "Uncategorised"}
              {bug.requirement ? ` · violates ${bug.requirement.title}` : ""}
              {bug.assignee ? ` · assigned to ${bug.assignee.full_name}` : ""}
            </p>
            {bug.base_page_id && (
              <p className="mt-1 text-xs text-slate-400">
                Originated from a library entry (informational only).
              </p>
            )}
            {bug.copied_from_bug_id && (
              <p className="mt-1 text-xs text-slate-400">
                Copied from the other platform's project (informational only).
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {editable && (
            <section className="space-y-1.5 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Area:</span>
                <select
                  value={bug.area ?? ""}
                  onChange={(e) => setArea((e.target.value || null) as BugArea | null)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
                >
                  <option value="">Not set</option>
                  {roleCats.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {areaSuggestion && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-slate-500">
                      suggested {categoryOf(roleCats, areaSuggestion.area)?.label}
                      {areaSuggestion.matched.length ? ` (${areaSuggestion.matched.join(", ")})` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setArea(areaSuggestion.area)}
                      className="rounded bg-brand px-2 py-0.5 font-medium text-white hover:bg-brand-fg"
                    >
                      Use it
                    </button>
                  </span>
                )}
              </div>
              {projectDevelopers &&
                bug.status !== "closed" &&
                roleCats.some((c) => c.key !== bug.area && areaPatch(bug, c.key, projectDevelopers).assignee_id) && (
                  <label className="flex items-center gap-1.5 text-slate-500">
                    <input type="checkbox" checked={moveToAreaDev} onChange={(e) => setMoveToAreaDev(e.target.checked)} />
                    When the area changes, move this bug to that area&apos;s developer
                  </label>
                )}
            </section>
          )}
          <section className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-medium">App version:</span>
            {editable ? (
              <select
                value={bug.release_id ?? ""}
                onChange={(e) => setRelease(e.target.value || null)}
                className="rounded-md border border-slate-300 px-2 py-1 text-[13px]"
              >
                <option value="">— unknown —</option>
                {bug.release && !releases.some((r) => r.id === bug.release!.id) && (
                  <option value={bug.release.id}>v{bug.release.version}</option>
                )}
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    v{r.version}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-slate-800">
                {bug.release?.version ? `v${bug.release.version}` : "unknown"}
              </span>
            )}
            {bug.release_id &&
              (bug.version_confirmed_at ? (
                <span className="text-brand-fg" suppressHydrationWarning>
                  ✓ confirmed by {bug.confirmer?.full_name ?? "QA"}, {fmtDateTime(bug.version_confirmed_at)}
                  {editable && (
                    <button
                      onClick={() => setVersionConfirmed(false)}
                      className="ml-2 text-slate-400 hover:text-slate-600 hover:underline"
                    >
                      undo
                    </button>
                  )}
                </span>
              ) : editable ? (
                <button
                  onClick={() => setVersionConfirmed(true)}
                  className="rounded bg-brand/10 px-2 py-0.5 font-medium text-brand-fg hover:bg-brand/20"
                  title="Confirm this bug was found in this version of the app"
                >
                  Confirm v{bug.release?.version}
                </button>
              ) : (
                <span className="text-amber-700">not confirmed by QA yet</span>
              ))}
            {editable && bug.version_confirmed_at && (
              <span className="basis-full text-[11px] text-slate-400">
                Changing the version clears the confirmation.
              </span>
            )}
          </section>

          {!editable && isStaff(role) && (
            <section className="rounded-md border border-grid-line bg-grid-head/40 p-3">
              <p className="text-xs text-slate-600">
                Assigned to <b>{bug.assignee?.full_name ?? "nobody"}</b> · status <b>{titleCase(bug.status)}</b>
              </p>
              {devTargets.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {devTargets.includes("in_progress") && (
                    <Button variant="secondary" disabled={statusBusy} onClick={() => developerSetStatus("in_progress")}>
                      Start working on it
                    </Button>
                  )}
                  {devTargets.includes("fixed") && !fixNoteOpen && (
                    <Button disabled={statusBusy} onClick={() => setFixNoteOpen(true)}>
                      Mark fixed
                    </Button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  {bug.status === "closed"
                    ? "This bug is closed."
                    : "Marked fixed: QA will verify and close it, or reopen it."}
                </p>
              )}
              {fixNoteOpen && (
                <div className="mt-2">
                  <textarea
                    value={fixNote}
                    onChange={(e) => setFixNote(e.target.value)}
                    rows={2}
                    autoFocus
                    placeholder="Optional note for QA: what changed, which build has the fix…"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="mt-1 flex gap-2">
                    <Button disabled={statusBusy} onClick={() => developerSetStatus("fixed", fixNote)}>
                      {statusBusy ? "Saving…" : "Confirm fixed"}
                    </Button>
                    <Button variant="ghost" onClick={() => setFixNoteOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {editable && (
            <section className="grid gap-3 rounded-md border border-grid-line bg-grid-head/40 p-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Assigned to
                </label>
                {canAssign ? (
                  <select
                    value={bug.assignee_id ?? ""}
                    onChange={(e) => setAssignee(e.target.value || null)}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                  >
                    <option value="">— Unassigned —</option>
                    {bug.assignee_id &&
                      !assignable.some((m) => m.id === bug.assignee_id) && (
                        <option value={bug.assignee_id}>
                          {bug.assignee?.full_name ?? "Unknown"}
                        </option>
                      )}
                    <AssigneeOptions people={assignable} area={bug.area} withRole />
                  </select>
                ) : (
                  <p className="text-[13px] text-slate-700">
                    {bug.assignee?.full_name ?? "Unassigned"}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Status
                </label>
                <select
                  value={bug.status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
                >
                  {BUG_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              {bug.status !== "ready_for_retest" && (
                <Button variant="secondary" onClick={() => setStatus("fixed")}>
                  Mark fixed
                </Button>
              )}
              <Button onClick={() => setStatus("ready_for_retest")}>
                Mark fixed → ready for retest
              </Button>
              {siblingProject && (
                <Button
                  variant="secondary"
                  onClick={copyToSibling}
                  disabled={copyState !== "idle"}
                >
                  {copyState === "done"
                    ? `Copied to ${siblingProject.name}`
                    : copyState === "busy"
                      ? "Copying…"
                      : `Copy to ${siblingProject.platform === "ios" ? "iOS" : "Android"}`}
                </Button>
              )}
            </div>
          )}
          {isManager(role) && (
            <div className="rounded-md border border-grid-line bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Automation</span>
                {projPlatform ? (
                  <Badge tone={projPlatform === "ios" ? "amber" : "green"}>
                    {projPlatform === "ios" ? "iOS → Mac runner" : "Android → Windows runner"}
                  </Badge>
                ) : autoReady ? (
                  <Badge tone="slate">No platform set</Badge>
                ) : (
                  <Badge tone="slate">Checking…</Badge>
                )}
                {job && (
                  <Badge
                    tone={
                      job.status === "generated"
                        ? "green"
                        : job.status === "failed"
                          ? "red"
                          : job.status === "cancelled"
                            ? "slate"
                            : "blue"
                    }
                  >
                    {job.status === "queued"
                      ? "Queued"
                      : job.status === "claimed"
                        ? "With runner"
                        : job.status === "generated"
                          ? "Test generated"
                          : job.status === "failed"
                            ? "Generation failed"
                            : "Cancelled"}
                  </Badge>
                )}
                <Button
                  variant="secondary"
                  className="ml-auto"
                  onClick={sendToAutomation}
                  disabled={
                    jobBusy || !autoReady || !projPlatform || job?.status === "queued" || job?.status === "claimed"
                  }
                >
                  {job && (job.status === "queued" || job.status === "claimed")
                    ? "In automation"
                    : job
                      ? "Send again"
                      : "Send to automation"}
                </Button>
              </div>
              {autoReady && !projPlatform && (
                <p className="mt-1 text-xs text-slate-500">
                  Set this project&apos;s platform in its Settings first, so the bug goes to the right machine.
                </p>
              )}
              {projPlatform && !hasHouse && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  ⚠ No app is linked to this project yet. You can still send the bug and it will be queued, but a runner cannot generate tests for it until an admin maps this project to one of the automated apps.
                </p>
              )}
              {job?.note && <p className="mt-1 text-xs text-slate-500">{job.note}</p>}
            </div>
          )}
          {editable && (
            <p className="text-xs text-slate-400">
              “Ready for retest” notifies the bug reporter to verify the fix.
              {siblingProject &&
                ` "Copy to ${siblingProject.platform === "ios" ? "iOS" : "Android"}" creates an independent copy in ${siblingProject.name} -- editing one doesn't affect the other.`}
            </p>
          )}

          {isManager(role) && (
            <div className="flex justify-end border-t border-grid-line pt-3">
              <Button variant="danger" onClick={deleteBug}>
                Delete bug
              </Button>
            </div>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">
              Description
            </h3>
            {!editable ? (
              <>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-800">
                  {bug.description || <span className="text-slate-400">No description</span>}
                </p>
                <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">Steps to reproduce</h3>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
                  {bug.steps_to_reproduce || "—"}
                </pre>
              </>
            ) : (
            <>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">
              Steps to reproduce
            </h3>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            {editable && (
              <Button
                variant="secondary"
                className="mt-2"
                onClick={saveText}
                disabled={savingText}
              >
                {savingText ? "Saving…" : "Save text"}
              </Button>
            )}
            </>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Attachments
            </h3>
            <AttachmentGallery attachments={attachments} />
            {isStaff(role) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input type="file" onChange={upload} className="text-xs" />
                {phoneHelper && (
                <>
                <Button
                  variant="secondary"
                  onClick={() => takePhoneScreenshot()}
                  disabled={shotBusy}
                  title="Captures the phone connected to this PC over USB (needs the aktrade Control Center running here)"
                >
                  {shotBusy ? "Capturing…" : "📱 Take phone screenshot"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={captureWhere}
                  disabled={shotBusy}
                  title="Attaches the app screen, its elements and the path you took on the test phone, and teaches automation where this bug is"
                >
                  📍 Capture where it happens
                </Button>
                </>
                )}
              </div>
            )}
            {phoneChoice && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                Several phones are connected. Capture:
                {phoneChoice.map((p) => (
                  <Button key={p.serial} variant="ghost" onClick={() => takePhoneScreenshot(p.serial)}>
                    {p.model || p.serial}
                  </Button>
                ))}
              </div>
            )}
          </section>

          <BugComments bugId={bug.id} userId={userId} role={role} refreshKey={commentsKey} />

          {err && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
