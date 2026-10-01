"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import NotificationBell from "@/components/NotificationBell";
import InstallButton from "@/components/InstallButton";
import AndroidAppButton from "@/components/AndroidAppButton";
import { cx } from "@/components/ui";
import type { Project, RoleLevel } from "@/lib/types/models";

const DESKTOP_MQ = "(min-width: 1024px)";

export default function AppShell({
  userId,
  projects,
  level,
  roleLabel,
  fullName,
  children,
}: {
  userId: string;
  projects: Pick<Project, "id" | "name">[];
  level: RoleLevel;
  roleLabel: string;
  fullName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // desktop: sidebar is docked and collapsible (preference persisted)
  const [desktopExpanded, setDesktopExpanded] = useState(true);
  // mobile: sidebar is an overlay drawer
  const [mobileOpen, setMobileOpen] = useState(false);

  const [restored, setRestored] = useState(false);

  // restore the persisted desktop preference on mount
  useEffect(() => {
    try {
      if (localStorage.getItem("sidebar") === "0") setDesktopExpanded(false);
    } catch {
      /* ignore */
    }
    setRestored(true);
  }, []);

  // persist changes (only after the stored value has been read back)
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem("sidebar", desktopExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [desktopExpanded, restored]);

  // close the mobile drawer on navigation
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = useCallback(() => {
    const desktop =
      typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
    if (desktop) setDesktopExpanded((v) => !v);
    else setMobileOpen((v) => !v);
  }, []);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-white">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-64 transform bg-white shadow-xl transition-transform duration-200",
          "lg:static lg:z-auto lg:h-full lg:transform-none lg:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          desktopExpanded ? "lg:block lg:w-64" : "lg:hidden",
        )}
      >
        <Sidebar
          projects={projects}
          level={level}
          roleLabel={roleLabel}
          fullName={fullName}
          onNavigate={() => setMobileOpen(false)}
          onCollapse={toggle}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-grid-line bg-white px-3 shadow-card sm:px-4">
          <button
            onClick={toggle}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-grid-head"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4h12M2 8h12M2 12h12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span
            className={cx(
              "flex items-center gap-1.5 text-sm font-semibold text-slate-800",
              desktopExpanded && "lg:hidden",
            )}
          >
            <img src="/brand/logo-mark.png" alt="Catalyst" className="h-7 w-7 shrink-0 object-contain" />
            Catalyst
          </span>
          <div className="ml-auto flex items-center gap-2">
            <AndroidAppButton variant="header" />
            <InstallButton />
            <NotificationBell userId={userId} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
