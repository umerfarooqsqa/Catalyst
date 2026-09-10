"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { createProject } from "./actions";

export default function NewProjectForm() {
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ New project</Button>;
  }

  return (
    <Card className="mb-4 p-4">
      <form action={createProject} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-slate-800">New project</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[13px] text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-slate-600">
            Project name
          </span>
          <input
            name="name"
            autoFocus
            placeholder="e.g. Acme Storefront"
            required
            className="w-full rounded-sm border border-slate-300 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-slate-600">
            Description <span className="text-slate-400">(optional)</span>
          </span>
          <textarea
            name="description"
            placeholder="Which app is this and which team owns it?"
            rows={2}
            className="w-full rounded-sm border border-slate-300 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </label>
        <Button type="submit">Create project</Button>
      </form>
    </Card>
  );
}
