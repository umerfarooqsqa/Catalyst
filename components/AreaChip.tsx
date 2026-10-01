"use client";

import { cx } from "@/components/ui";
import { useRoleCategories } from "@/components/RoleCategories";
import { categoryOf, colorClass } from "@/lib/bug-area";

/** A role category badge (migration 0043). `showMissing` renders "Category not set" for null. */
export default function AreaChip({
  area,
  showMissing = false,
  className,
}: {
  area: string | null | undefined;
  showMissing?: boolean;
  className?: string;
}) {
  const cat = categoryOf(useRoleCategories(), area);
  if (!cat) {
    return showMissing ? (
      <span
        className={cx(
          "inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500",
          className,
        )}
      >
        Category not set
      </span>
    ) : null;
  }
  return (
    <span
      title={cat.label}
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        colorClass(cat.color),
        className,
      )}
    >
      {cat.short_label}
    </span>
  );
}
