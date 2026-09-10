"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export default function ProjectTabs({
  projectId,
  canSettings,
}: {
  projectId: string;
  canSettings: boolean;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/bugs`, label: "Bugs" },
    { href: `${base}/tasks`, label: "Tasks" },
    { href: `${base}/requirements`, label: "Requirements" },
    ...(canSettings ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-grid-line">
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium",
              active
                ? "border-brand text-brand-fg"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
