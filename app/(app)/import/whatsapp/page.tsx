import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCategories } from "@/lib/data";
import { PageHeader, EmptyState } from "@/components/ui";
import { isManager } from "@/lib/permissions";
import WhatsAppImport, { type InboxRow } from "@/components/WhatsAppImport";

export const dynamic = "force-dynamic";

/** Import bugs and tasks from Grok's WhatsApp triage sheet (migration 0046). QA/admin only. */
export default async function WhatsAppImportPage() {
  const { level } = await requireProfile();
  if (!isManager(level)) {
    return (
      <div>
        <PageHeader title="Import from WhatsApp" />
        <EmptyState title="QA or an admin only">Ask QA to import the WhatsApp sheet.</EmptyState>
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: projects }, categories, { data: waiting, error: inboxErr }] = await Promise.all([
    supabase.from("projects").select("id, name, platform").order("name"),
    getCategories(),
    // Grok's rows waiting for review (migration 0047); hidden until it is applied.
    supabase.rpc("whatsapp_inbox_waiting"),
  ]);
  const inbox: InboxRow[] | null = inboxErr
    ? null
    : (waiting ?? []).map((w) => ({
        item_id: w.item_id,
        row: (w.row ?? {}) as Record<string, string>,
        last_received_at: w.last_received_at,
      }));

  return (
    <div>
      <PageHeader
        title="Import from WhatsApp"
        subtitle="Grok's rows for known projects are filed automatically. Rows whose project isn't in catalyst yet (or is unclear) wait here: choose a project or let the import create it, then import. You can also upload Grok's “Catalyst import” sheet. Support and FYI rows, internal groups and items already imported are always skipped."
      />
      <WhatsAppImport
        projects={projects ?? []}
        categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
        inbox={inbox}
      />
    </div>
  );
}
