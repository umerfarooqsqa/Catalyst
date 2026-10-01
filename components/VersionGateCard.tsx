"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { updateProjectVersion } from "@/app/(app)/projects/actions";

type ReleaseRow = {
  id: string;
  version: string;
  release_notes_ref: string | null;
  started_at: string;
  status: string;
  discrepancies: unknown[] | null;
};

/**
 * Release notes + REQ-2 version gate.
 *
 * Testing a version starts only once its release notes are here. The aktrade
 * runner refuses to begin (Control Center, Development Portal, pytest) until
 * the project's current version has notes AND the phone's installed app
 * reports that version.
 *
 * Paste or upload the notes. The version is read from them (lib/parse-version.ts)
 * into an editable field, and Save stores the notes on that version's release,
 * makes it the current version, and cross-checks the notes against the
 * project's bugs (POST /api/projects/[id]/release-notes).
 */
export default function VersionGateCard({
  projectId,
  houseSlug,
  initialVersion,
  initialReleaseNotesRef,
  initialNotifyEmails,
}: {
  projectId: string;
  houseSlug: string;
  initialVersion: string;
  initialReleaseNotesRef: string;
  initialNotifyEmails: string;
}) {
  const router = useRouter();
  const [version, setVersion] = useState(initialVersion);
  const [releaseNotesRef, setReleaseNotesRef] = useState(initialReleaseNotesRef);
  const [notifyEmails, setNotifyEmails] = useState(initialNotifyEmails);
  const [pasteText, setPasteText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notesVersion, setNotesVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadReleases = useCallback(async () => {
    const { data } = await createClient()
      .from("releases")
      .select("id, version, release_notes_ref, started_at, status, discrepancies")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(20);
    setReleases((data as ReleaseRow[]) ?? []);
  }, [projectId]);
  useEffect(() => {
    loadReleases();
  }, [loadReleases]);

  const current = releases.find((r) => r.version === version && r.release_notes_ref);

  async function readNotes(body: BodyInit, headers?: HeadersInit) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/release-notes/parse", { method: "POST", body, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the release notes");
      setNotesVersion(data.version ?? "");
      setMsg(
        data.version
          ? `The notes are for version ${data.version}. Check it, then save.`
          : "No version number found in the notes: type it below, then save.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the release notes");
    } finally {
      setBusy(false);
    }
  }

  function readPasted() {
    if (!pasteText.trim()) {
      setErr("Paste the release notes first, or choose a file.");
      return;
    }
    setFile(null);
    readNotes(JSON.stringify({ text: pasteText }), { "content-type": "application/json" });
  }

  function readFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const form = new FormData();
    form.append("file", f);
    readNotes(form);
  }

  async function saveNotes() {
    if (!file && !pasteText.trim()) {
      setErr("Add the release notes first (paste or upload).");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", pasteText);
      form.append("version", notesVersion);
      const res = await fetch(`/api/projects/${projectId}/release-notes`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the release notes");
      setVersion(data.version);
      setReleaseNotesRef(data.path);
      setMsg(
        `Saved: release notes for ${data.version}, now the current version. Cross-check: ${data.claims} claim(s), ` +
          `${data.discrepancies.length} discrepancy(ies), ${data.claimed_bugs.length} claimed fix(es) matched to bugs.`,
      );
      setPasteText("");
      setFile(null);
      setNotesVersion("");
      if (fileRef.current) fileRef.current.value = "";
      loadReleases();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function openNotes(ref: string) {
    const { data } = await createClient().storage.from("attachments").createSignedUrl(ref, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <Card className="mt-6 p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Release notes &amp; version gate</h2>
      <p className="mb-3 text-xs text-slate-500">
        Testing for app <code>{houseSlug}</code> starts only after the release notes for its version are added here,
        and only when the app on the test phone reports that same version. Bugs are filed under that version.
      </p>

      <div
        className={`mb-3 rounded-md px-3 py-2 text-xs ${
          current ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
        }`}
      >
        {version ? (
          current ? (
            <>
              Current version <b>{version}</b>: release notes added{" "}
              <button className="underline" onClick={() => openNotes(current.release_notes_ref!)}>
                (open)
              </button>
              . Testing may start.
            </>
          ) : (
            <>
              Current version <b>{version}</b> has <b>no release notes</b>: testing is blocked until they are added.
            </>
          )
        ) : (
          <>No version yet: add the release notes to set it. Testing is blocked until then.</>
        )}
      </div>

      <div className="mb-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-medium text-slate-600">Add release notes (paste or upload PDF/DOCX/TXT/MD)</p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          placeholder="Paste the release notes here…"
          className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={readPasted} disabled={busy}>
            Read pasted notes
          </Button>
          <span className="text-xs text-slate-400">or upload</span>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={readFile} disabled={busy} className="text-xs" />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            App version of these notes
            <input
              type="text"
              value={notesVersion}
              onChange={(e) => setNotesVersion(e.target.value)}
              placeholder="e.g. 1.0.7"
              className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <Button type="button" onClick={saveNotes} disabled={busy || (!file && !pasteText.trim())}>
            {busy ? "Working…" : "Save release notes"}
          </Button>
        </div>
        {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      </div>

      {releases.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-slate-600">Releases</p>
          <ul className="space-y-1 text-xs text-slate-600">
            {releases.map((r) => (
              <li key={r.id}>
                <b>{r.version}</b> · {new Date(r.started_at).toLocaleDateString()} · {r.status.replace("_", " ")} ·{" "}
                {r.release_notes_ref ? (
                  <button className="text-brand underline" onClick={() => openNotes(r.release_notes_ref!)}>
                    notes
                  </button>
                ) : (
                  <span className="text-amber-700">no notes</span>
                )}
                {r.discrepancies && r.discrepancies.length > 0 && (
                  <span className="text-amber-700"> · {r.discrepancies.length} discrepancy(ies)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit version / completion emails (admin)</summary>
        <form action={updateProjectVersion} className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <input type="hidden" name="project_id" value={projectId} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Current version
            <input
              type="text"
              name="current_version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.0.7"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-40"
            />
          </label>
          <input type="hidden" name="release_notes_ref" value={releaseNotesRef} />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Completion email recipients
            <input
              type="text"
              name="notify_emails"
              value={notifyEmails}
              onChange={(e) => setNotifyEmails(e.target.value)}
              placeholder="qa@company.com, lead@company.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-72"
            />
          </label>
          <Button type="submit">Save</Button>
        </form>
        <p className="mt-1 text-xs text-slate-400">A version set here without release notes still blocks testing.</p>
      </details>
    </Card>
  );
}
