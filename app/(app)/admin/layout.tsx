import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { canAdminister } from "@/lib/permissions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { level } = await requireProfile();
  if (!canAdminister(level)) redirect("/dashboard");
  return <>{children}</>;
}
