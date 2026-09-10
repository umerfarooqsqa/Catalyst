"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteProject } from "@/app/(app)/projects/actions";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-sm bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

/**
 * Row-level "delete project" for the projects list. Expands to a
 * type-the-name confirmation (the server action re-checks it) and
 * disables itself while deleting so a stray second click can't fire a
 * duplicate submit.
 */
export default function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 hover:text-red-600"
      >
        delete
      </button>
    );
  }

  return (
    <form
      action={deleteProject}
      className="flex items-center justify-end gap-1.5"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input
        name="confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`type “${projectName}”`}
        autoComplete="off"
        aria-label={`Type ${projectName} to confirm deletion`}
        className="w-44 rounded-sm border border-slate-300 px-1.5 py-1 text-xs outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400"
      />
      <SubmitButton disabled={confirm.trim() !== projectName} />
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setConfirm("");
        }}
        className="text-xs text-slate-400 hover:text-slate-700"
      >
        cancel
      </button>
    </form>
  );
}
