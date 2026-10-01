import { cx } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

/**
 * The app version a bug belongs to, and whether QA has confirmed it (migration 0037).
 * Shown wherever a bug is listed (Bugs sheet and cards, My Queue, Retest), so developers
 * always know which build to look at.
 */
export default function VersionChip({
  version,
  confirmedAt,
  confirmedBy,
  showMissing = false,
  className,
}: {
  version: string | null | undefined;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  /** Show "no version" instead of nothing when the bug has none. */
  showMissing?: boolean;
  className?: string;
}) {
  if (!version) {
    return showMissing ? (
      <span
        className={cx("shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-800", className)}
        title="No app version set for this bug"
      >
        no version
      </span>
    ) : null;
  }
  const confirmed = !!confirmedAt;
  return (
    <span
      suppressHydrationWarning
      className={cx(
        "shrink-0 whitespace-nowrap rounded border px-1 text-[10px]",
        confirmed ? "border-brand-line bg-brand-soft text-brand-fg" : "border-slate-200 bg-slate-100 text-slate-500",
        className,
      )}
      title={
        confirmed
          ? `App version v${version}, confirmed${confirmedBy ? ` by ${confirmedBy}` : ""} ${fmtDateTime(confirmedAt!)}`
          : `App version v${version}, not confirmed by QA yet`
      }
    >
      v{version}
      {confirmed ? " ✓" : ""}
    </span>
  );
}
