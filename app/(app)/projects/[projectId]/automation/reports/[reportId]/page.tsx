import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { canSeeAutomation } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import AutotestReport from "@/components/AutotestReport";
import type { AutotestReportData } from "@/lib/autotest-report";

export const dynamic = "force-dynamic";

const LINK_SECONDS = 60 * 60;

/**
 * One auto-test report (migration 0039): what the runner tested on this app, requirement
 * coverage, past bugs re-checked, findings (each can be filed as a bug), the screen map and
 * the downloads. Hidden from developers, like the rest of automation (0036).
 */
export default async function AutotestReportPage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;
  const { level } = await requireProfile();
  if (!canSeeAutomation(level)) redirect(`/projects/${projectId}`);
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("automation_reports")
    .select("id, project_id, version, run_id, runner, status, created_at, cost_usd, report, files, excel_path")
    .eq("id", reportId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row) notFound();

  // Signed links for the stored files (the bucket is private): screenshots and the workbook.
  const files = (row.files ?? {}) as Record<string, string>;
  const names = Object.keys(files);
  const links: Record<string, string> = {};
  if (names.length) {
    const { data } = await supabase.storage
      .from("automation-reports")
      .createSignedUrls(names.map((n) => files[n]), LINK_SECONDS);
    (data ?? []).forEach((d, i) => {
      if (d.signedUrl) links[names[i]] = d.signedUrl;
    });
  }
  const excelName = row.excel_path ? row.excel_path.split("/").pop() ?? "" : "";

  return (
    <AutotestReport
      projectId={projectId}
      reportId={row.id}
      createdAt={row.created_at}
      report={row.report as unknown as AutotestReportData}
      links={links}
      excel={excelName && links[excelName] ? { name: excelName, url: links[excelName] } : null}
      role={level}
    />
  );
}
