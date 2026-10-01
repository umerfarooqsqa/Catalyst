"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { Project, RoleLevel } from "@/lib/types/models";
import { canAdminister, canSeeAutomation, canManageProjects } from "@/lib/permissions";
import AndroidAppButton from "@/components/AndroidAppButton";

/* --- tiny inline icon set (16px, currentColor) --- */
const I = {
  home: "M2 8.5 8 3l6 5.5M4 7.5V13h3v-3h2v3h3V7.5",
  queue: "M2.5 4h11M2.5 8h11M2.5 12h7",
  library: "M3 2.5h3.2v11H3zM6.8 2.5H10v11H6.8zM11 3.4l2.2.6-2.6 10-2.2-.6z",
  robot: "M4 5.5h8a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11V7A1.5 1.5 0 0 1 4 5.5zM8 5.5V3M6 8.5v.5M10 8.5v.5",
  bell: "M8 2a3 3 0 0 0-3 3v3l-1.2 2.2h8.4L11 8V5a3 3 0 0 0-3-3zM6.5 12.5a1.5 1.5 0 0 0 3 0",
  folder: "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.2l1.2 1.5h5.6A1.5 1.5 0 0 1 16 6v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V4.5z",
  users: "M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm5 0a2 2 0 1 0 0-4M2 14v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1m1-1v-.5a2.5 2.5 0 0 0-2-2.45",
  shield: "M8 1.5 3 3.2V8c0 3 2.2 5.3 5 6.5 2.8-1.2 5-3.5 5-6.5V3.2z",
  clock: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 5.5V8l1.8 1",
  tag: "M2.5 2.5h5L14 9l-4.5 4.5L3 7V2.5zM5 5a.6.6 0 1 0 0-1.2A.6.6 0 0 0 5 5z",
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

export default function Sidebar({
  projects,
  level,
  roleLabel,
  fullName,
  onNavigate,
  onCollapse,
}: {
  projects: Pick<Project, "id" | "name">[];
  level: RoleLevel;
  roleLabel: string;
  fullName: string;
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const pathname = usePathname();
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({
    href,
    label,
    icon,
  }: {
    href: string;
    label: string;
    icon?: keyof typeof I;
  }) => (
    <Link
      href={href}
      onClick={onNavigate}
      className={cx(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
        active(href)
          ? "bg-brand-soft font-semibold text-brand-fg shadow-[inset_3px_0_0_0_theme(colors.brand.DEFAULT)]"
          : "text-slate-600 hover:bg-white hover:text-slate-900",
      )}
    >
      {icon ? <Icon d={I[icon]} /> : <span className="w-[15px]" />}
      <span className="truncate">{label}</span>
    </Link>
  );

  const SectionLabel = ({
    children,
    action,
  }: {
    children: React.ReactNode;
    action?: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {children}
      </span>
      {action}
    </div>
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-grid-line bg-grid-head/60">
      <div className="flex items-center gap-2 border-b border-grid-line px-3 py-2.5">
        <img src="/brand/logo-mark.png" alt="Catalyst" className="h-8 w-8 shrink-0 object-contain" />
        <div>
          <div className="text-[13px] font-semibold leading-none text-slate-800">
            Catalyst
          </div>
          <div className="text-[10px] text-slate-400">Task &amp; Bug Tracking</div>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="ml-auto rounded-sm p-1 text-slate-400 hover:bg-white hover:text-slate-700"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 3 5 8l5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <NavLink href="/dashboard" label="Home" icon="home" />
        <NavLink href="/my-queue" label="My Queue" icon="queue" />
        <NavLink href="/master-library" label="Bug Library" icon="library" />
        {canSeeAutomation(level) && <NavLink href="/automation" label="Automation" icon="robot" />}
        <NavLink href="/notifications" label="Notifications" icon="bell" />

        <SectionLabel
          action={
            canManageProjects(level) && (
              <Link
                href="/projects?new=1"
                onClick={onNavigate}
                title="New project"
                aria-label="New project"
                className="-my-1 rounded-md px-1.5 text-base leading-none text-brand-fg hover:bg-white"
              >
                +
              </Link>
            )
          }
        >
          Projects
        </SectionLabel>
        {projects.length === 0 ? (
          <p className="px-2.5 text-xs text-slate-400">No projects yet</p>
        ) : (
          projects.map((p) => (
            <NavLink
              key={p.id}
              href={`/projects/${p.id}`}
              label={p.name}
              icon="folder"
            />
          ))
        )}
        <NavLink href="/projects" label="All projects" />

        {canAdminister(level) && (
          <>
            <SectionLabel>Admin</SectionLabel>
            <NavLink href="/admin/users" label="Users" icon="users" />
            <NavLink href="/admin/roles" label="Roles" icon="shield" />
            <NavLink href="/admin/role-categories" label="Role categories" icon="users" />
            <NavLink href="/admin/categories" label="Bug categories" icon="tag" />
            <NavLink href="/admin/audit-log" label="Audit log" icon="clock" />
          </>
        )}
      </nav>

      <div className="border-t border-grid-line p-2">
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-fg">
            {fullName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join("")}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-700">
              {fullName}
            </div>
            <div className="text-[11px] text-slate-500">{roleLabel}</div>
          </div>
        </div>
        <AndroidAppButton variant="sidebar" />
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
