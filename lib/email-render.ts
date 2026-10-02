/**
 * Subject, text and HTML for one row of `email_outbox` (migration 0044). The row's `items`
 * are the bugs it lists, as they were when the email was built (latest status per bug).
 * Bugs are grouped by project (decided with the user, 2026-10-02): each project has a heading
 * with its bug count and a link to that project's Bugs page, then its bugs, each with its link.
 */
export type EmailItem = {
  id: string;
  ref: string;
  title: string;
  project: string;
  project_id: string;
  severity: string;
  status: string;
  event: string;
  link: string;
};

export type EmailKind = "instant" | "critical" | "batch" | "digest";

export type RenderedEmail = { subject: string; text: string; html: string };

type ProjectGroup = { name: string; link: string; items: EmailItem[] };

const EVENT_LABELS: Record<string, string> = {
  assignment: "Assigned to you",
  status_change: "Status changed",
  comment: "New comment",
  retest_ready: "Ready for retest",
};

const words = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const eventLabel = (e: string) => EVENT_LABELS[e] ?? words(e);
const bugs = (n: number) => `${n} bug${n === 1 ? "" : "s"}`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A bug's link is <app>/projects/<id>/bugs?focus=<bug>; its project's page is the same without the query. */
function projectLink(item: EmailItem): string {
  try {
    const u = new URL(item.link);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return item.link;
  }
}

/** Projects by name; each project's bugs keep the email's order (most severe first). */
function byProject(items: EmailItem[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const i of items) {
    const key = i.project_id || i.project;
    const g = groups.get(key) ?? { name: i.project, link: projectLink(i), items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function subjectOf(kind: EmailKind, items: EmailItem[], groups: ProjectGroup[]): string {
  const first = items[0];
  if (kind === "critical") return `[Catalyst] CRITICAL: ${first.title} (${first.project})`;
  if (kind === "instant") return `[Catalyst] ${eventLabel(first.event)}: ${first.title} (${first.project})`;
  const where =
    groups.length === 1
      ? ` in ${first.project}`
      : groups.length <= 3
        ? ` in ${groups.map((g) => g.name).join(", ")}`
        : ` in ${groups.length} projects`;
  const n = `${items.length} bug update${items.length === 1 ? "" : "s"}`;
  return kind === "digest" ? `[Catalyst] Daily digest: ${n}${where}` : `[Catalyst] ${n}${where}`;
}

function intro(kind: EmailKind, items: EmailItem[], groups: ProjectGroup[]): string {
  const across = groups.length > 1 ? `, in ${groups.length} projects` : "";
  if (kind === "critical") return "A critical bug needs your attention:";
  if (kind === "instant") return "A bug you follow changed:";
  if (kind === "digest") return `Your daily summary of ${bugs(items.length)}${across}:`;
  return `${bugs(items.length)} you follow changed${across}:`;
}

export function renderEmail(kind: EmailKind, items: EmailItem[]): RenderedEmail {
  const groups = byProject(items);
  const origin = (() => {
    try {
      return new URL(items[0]?.link ?? "").origin;
    } catch {
      return "";
    }
  })();
  const prefs = origin ? `${origin}/notifications` : "the Notifications page";

  const text = [
    intro(kind, items, groups),
    "",
    ...groups.flatMap((g) => [
      `${g.name.toUpperCase()} (${bugs(g.items.length)})`,
      `Open project: ${g.link}`,
      "",
      ...g.items.flatMap((i) => [
        `  [${i.ref}] ${i.title}`,
        `    ${words(i.severity)} · ${words(i.status)} · ${eventLabel(i.event)}`,
        `    ${i.link}`,
        "",
      ]),
    ]),
    `Choose which emails you get: ${prefs}`,
  ].join("\n");

  const cell = "padding:8px 10px;border-bottom:1px solid #e2e8f0";
  const sections = groups
    .map((g) => {
      const rows = g.items
        .map(
          (i) => `<tr>
  <td style="${cell};font-family:monospace;color:#64748b;white-space:nowrap">${esc(i.ref)}</td>
  <td style="${cell}"><a href="${esc(i.link)}" style="color:#0f766e;font-weight:600;text-decoration:none">${esc(i.title)}</a><div style="color:#64748b;font-size:12px">${esc(eventLabel(i.event))}</div></td>
  <td style="${cell};white-space:nowrap;${i.severity === "critical" ? "color:#b91c1c;font-weight:600" : ""}">${esc(words(i.severity))}</td>
  <td style="${cell};white-space:nowrap">${esc(words(i.status))}</td>
</tr>`,
        )
        .join("\n");
      return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 6px">
<tr>
  <td style="padding:10px 0 6px;font-size:16px;font-weight:700;color:#0f172a">${esc(g.name)} <span style="font-weight:400;color:#64748b;font-size:13px">· ${bugs(g.items.length)}</span></td>
  <td style="padding:10px 0 6px;text-align:right"><a href="${esc(g.link)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:6px 12px;border-radius:6px;white-space:nowrap">Open project &rarr;</a></td>
</tr>
</table>
<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 18px">
<thead><tr style="text-align:left;color:#475569;font-size:12px;text-transform:uppercase">
  <th style="padding:6px 10px;background:#f1f5f9">ID</th><th style="padding:6px 10px;background:#f1f5f9">Bug</th><th style="padding:6px 10px;background:#f1f5f9">Severity</th><th style="padding:6px 10px;background:#f1f5f9">Status</th>
</tr></thead>
<tbody>
${rows}
</tbody></table>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
<p style="margin:0 0 8px;font-size:15px">${esc(intro(kind, items, groups))}</p>
${sections}
<p style="margin:4px 0 0;font-size:12px;color:#64748b">${origin ? `<a href="${esc(prefs)}" style="color:#64748b">Choose which emails you get</a>` : "Choose which emails you get on the Notifications page."}</p>
</div></body></html>`;

  return { subject: subjectOf(kind, items, groups), text, html };
}
