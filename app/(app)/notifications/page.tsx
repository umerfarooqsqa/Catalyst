import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import NotificationList from "./notification-list";
import PushToggle from "@/components/PushToggle";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { userId } = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <PageHeader title="Notifications" />
      <PushToggle userId={userId} />
      {!data || data.length === 0 ? (
        <EmptyState title="No notifications">
          You&apos;ll be pinged on assignment, status changes, comments, and
          retest-ready.
        </EmptyState>
      ) : (
        <NotificationList initial={data} />
      )}
    </div>
  );
}
