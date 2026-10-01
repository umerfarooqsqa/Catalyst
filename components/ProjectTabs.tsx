"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/* tab icons — same hand-drawn 16px style as Sidebar's icon set */
const TAB_ICON = {
  overview: "M2.5 13h2.5V7h-2.5zM6.75 13h2.5V3h-2.5zM11 13h2.5V9h-2.5z",
  bugs: "M8 5.2a2.3 2.3 0 0 1 2.3 2.3v2.6A2.3 2.3 0 0 1 8 12.4a2.3 2.3 0 0 1-2.3-2.3V7.5A2.3 2.3 0 0 1 8 5.2zM8 5.2V3.6M6 4l-1.2-1.2M10 4l1.2-1.2M3.2 8h2M10.8 8h2M3.6 11.2l1.6-1M12.4 11.2l-1.6-1",
  tasks: "M4 8.3 6.5 10.8 12 4.8M3 13h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1z",
  requirements: "M8 8a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM8 6.3A1.3 1.3 0 1 0 8 3.7a1.3 1.3 0 0 0 0 2.6z",
  settings: "M8 10.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM8 2v1.4M8 12.6V14M14 8h-1.4M3.4 8H2M12.2 3.8l-1 1M4.8 11.2l-1 1M12.2 12.2l-1-1M4.8 4.8l-1-1",
  retest: "M13 8A5 5 0 1 1 8 3M13 8V4.5M13 8H9.5M8 5.3V8l2 1.3",
  automation: "M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11V7A1.5 1.5 0 0 1 4 5.5zM8 5.5V3M6 8.5v.5M10 8.5v.5",
} as const;

function TabIcon({ d }: { d: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

export default function ProjectTabs({
  projectId,
  canSettings,
  canAutomation = true,
}: {
  projectId: string;
  canSettings: boolean;
  /** Developers don't see the Automation tab (canSeeAutomation). */
  canAutomation?: boolean;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Overview", icon: "overview" as const, exact: true },
    { href: `${base}/bugs`, label: "Bugs", icon: "bugs" as const },
    { href: `${base}/tasks`, label: "Tasks", icon: "tasks" as const },
    {
      href: `${base}/requirements`,
      label: "Requirements",
      icon: "requirements" as const,
    },
    { href: `${base}/retest`, label: "Retest", icon: "retest" as const },
    ...(canAutomation
      ? [{ href: `${base}/automation`, label: "Automation", icon: "automation" as const }]
      : []),
    ...(canSettings
      ? [{ href: `${base}/settings`, label: "Settings", icon: "settings" as const }]
      : []),
  ];

  // On a phone the tab strip is wider than the screen: keep the current tab in view and fade
  // the edge while more tabs are hidden, so it reads as scrollable rather than cut off.
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    const update = () => setMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
    update();
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      nav.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className={cx(
        "mb-4 flex gap-1 overflow-x-auto border-b border-grid-line [-webkit-overflow-scrolling:touch] [scrollbar-width:none]",
        more && "[mask-image:linear-gradient(to_right,#000_82%,transparent)]",
      )}
    >
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] font-medium transition active:scale-95 sm:px-3",
              active
                ? "border-brand text-brand-fg"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            <TabIcon d={TAB_ICON[t.icon]} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
