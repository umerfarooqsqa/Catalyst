"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteProject } from "@/app/(app)/projects/actions";
import { Button, Input } from "@/components/ui";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={disabled || pending}>
      {pending ? "Deleting…" : "Delete this project"}
    </Button>
  );
}

/**
 * "Danger zone" delete for a whole project. The confirmation input must
 * match the project name exactly before the button enables, and the
 * button disables itself while the action is in flight so a second click
 * can't fire a duplicate submit. The server action re-checks the typed
 * name regardless.
 */
export default function DeleteProjectForm({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim() === projectName;

  return (
    <form action={deleteProject} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="text-[13px] text-slate-600">
        This permanently deletes <strong>{projectName}</strong> and everything in
        it — every bug, task, requirement, test case, uploaded requirements
        document, extracted client-requirement entry, comment, and attachment.
        This cannot be undone.
      </p>
      <div>
        <label
          htmlFor="confirm-project-name"
          className="mb-1 block text-[12px] font-medium text-slate-600"
        >
          Type <span className="font-mono text-slate-800">{projectName}</span> to
          confirm
        </label>
        <Input
          id="confirm-project-name"
          name="confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          className="max-w-sm"
        />
      </div>
      <SubmitButton disabled={!matches} />
    </form>
  );
}
