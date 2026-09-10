"use client";

import { useState } from "react";
import { parseDue, DueParseError, fmtDueShort } from "@/lib/parseDue";
import { fmtDateTime } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * "Due" field that takes a fast relative expression ("3d", "4h",
 * "tomorrow 9am", "2026-09-20 14:30") instead of a calendar click.
 * Commits on blur / Enter; shows a live "→ …" preview of what it
 * resolved to while you type. `compact` is the in-sheet variant.
 */
export default function DueInput({
  value,
  onCommit,
  onError,
  disabled,
  compact,
}: {
  value: string | null;
  onCommit: (iso: string | null) => void;
  onError?: (msg: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  function onChange(v: string) {
    setText(v);
    const trimmed = v.trim();
    if (!trimmed) {
      setPreview(null);
      setBad(false);
      return;
    }
    try {
      const iso = parseDue(v);
      setPreview(iso ? fmtDateTime(iso) : "cleared");
      setBad(false);
    } catch {
      setPreview(null);
      setBad(true);
    }
  }

  function commit() {
    setFocused(false);
    setPreview(null);
    const v = text.trim();
    setText("");
    if (!v) return; // untouched — keep the existing value
    try {
      onCommit(parseDue(v));
      onError?.(null);
      setBad(false);
    } catch (e) {
      setBad(true);
      onError?.(
        e instanceof DueParseError ? e.message : `Couldn't read "${v}" as a due date.`,
      );
    }
  }

  const overdue = value ? Date.parse(value) < Date.now() : false;
  const display = value ? (compact ? fmtDueShort(value) : fmtDateTime(value)) : "";

  return (
    <div className={compact ? "relative" : undefined}>
      <input
        tabIndex={compact ? -1 : undefined}
        disabled={disabled}
        value={focused ? text : display}
        placeholder={focused ? "3d · 4h · tomorrow 9am" : "—"}
        title={value ? fmtDateTime(value) : undefined}
        onFocus={(e) => {
          setFocused(true);
          setText("");
          e.currentTarget.select();
        }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setText("");
            setFocused(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={
          compact
            ? cx(
                "cell-input",
                bad ? "text-red-600" : overdue && "font-semibold text-red-700",
              )
            : cx(
                "w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40",
                bad ? "border border-red-400" : "border border-slate-300",
              )
        }
      />
      {focused && (preview || bad) && (
        <div
          className={cx(
            "text-[11px]",
            compact
              ? "absolute left-0 top-full z-30 mt-0.5 whitespace-nowrap rounded-sm border border-grid-line bg-white px-1.5 py-0.5 shadow-sm"
              : "mt-1",
            bad ? "text-red-600" : "text-slate-500",
          )}
        >
          {bad ? "Try 3d · 4h · tomorrow 9am · 2026-09-20" : `→ ${preview}`}
        </div>
      )}
    </div>
  );
}
