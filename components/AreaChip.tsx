import { cx } from "@/components/ui";
import { AREA_COLORS, AREA_SHORT, isBugArea } from "@/lib/bug-area";

/** Frontend / Backend badge (migration 0041). `showMissing` renders "Area not set" for null. */
export default function AreaChip({
  area,
  showMissing = false,
  className,
}: {
  area: string | null | undefined;
  showMissing?: boolean;
  className?: string;
}) {
  if (!isBugArea(area)) {
    return showMissing ? (
      <span
        className={cx(
          "inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500",
          className,
        )}
      >
        Area not set
      </span>
    ) : null;
  }
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        AREA_COLORS[area],
        className,
      )}
    >
      {AREA_SHORT[area]}
    </span>
  );
}
