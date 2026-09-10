import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-sm border border-grid-line bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-fg",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-grid-head",
  ghost: "text-slate-600 hover:bg-grid-head",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        BTN[variant],
        className,
      )}
    />
  );
}

export function LinkButton({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium transition",
        BTN[variant],
        className,
      )}
    />
  );
}

export function Badge({
  children,
  className,
  tone = "slate",
}: {
  children: ReactNode;
  className?: string;
  tone?: "slate" | "blue" | "green" | "amber" | "red" | "violet";
}) {
  const tones = {
    slate: "bg-grid-head text-slate-700 border-slate-300",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    green: "bg-brand-soft text-brand-fg border-brand-line",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-red-50 text-red-800 border-red-200",
    violet: "bg-violet-50 text-violet-800 border-violet-200",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "red" | "amber" | "green";
}) {
  const toneCls =
    tone === "red"
      ? "text-red-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "green"
          ? "text-brand-fg"
          : "text-slate-900";
  return (
    <div className="rounded-sm border border-grid-line bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={cx("mt-0.5 text-2xl font-semibold tabular-nums", toneCls)}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-sm border border-dashed border-grid-line bg-grid-head/40 p-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children ? (
        <div className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- Form fields ---------------------------- */

const FIELD =
  "w-full rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(FIELD, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(FIELD, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(FIELD, "pr-8", className)} />;
}

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[12px] font-medium text-slate-600"
    >
      {children}
      {hint ? (
        <span className="ml-1 font-normal text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function FormRow({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}

export { cx };
