"use client";

import { useCallback, useRef, useState } from "react";

type Pos = { r: number; c: number };

/**
 * Spreadsheet-style keyboard navigation for a table of editable cells.
 *
 * Model (Excel-ish):
 *  - click a cell  -> it's *selected* (outlined), not yet editing
 *  - Arrow keys    -> move the selection
 *  - Enter / F2 / typing a character -> enter *edit* mode (focus the cell's
 *    <input>/<select>)
 *  - Escape        -> leave edit mode, cell stays selected
 *  - Tab / Shift+Tab -> move selection left/right (never leaves the grid)
 *  - Enter while editing -> commit + move down
 *
 * Each editable cell renders `<td {...cellProps(r, c)}>` and puts its control
 * inside. The control should have `tabIndex={-1}` so it isn't focused until
 * the user chooses to edit.
 */
export function useGridNav(rows: number, cols: number) {
  const [sel, setSel] = useState<Pos | null>(null);
  const tds = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const key = (r: number, c: number) => `${r}:${c}`;

  const controlOf = (td: HTMLTableCellElement | undefined) =>
    td?.querySelector<HTMLElement>("input, select, textarea, [data-editable]") ??
    null;

  const select = useCallback((r: number, c: number, edit = false) => {
    r = Math.max(0, Math.min(rows - 1, r));
    c = Math.max(0, Math.min(cols - 1, c));
    setSel({ r, c });
    const td = tds.current.get(key(r, c));
    td?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (edit) {
      const ctl = controlOf(td);
      if (ctl) {
        ctl.focus();
        if (ctl instanceof HTMLInputElement && ctl.type === "text") ctl.select();
      } else td?.focus();
    } else {
      td?.focus();
    }
  }, [rows, cols]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableElement>) => {
      if (!sel) return;
      const { r, c } = sel;
      const activeTd = tds.current.get(key(r, c));
      const editing =
        !!activeTd &&
        activeTd.contains(document.activeElement) &&
        document.activeElement !== activeTd;

      // While a cell's control is focused ("editing"): the control handles
      // its own keys; only Escape / Enter / Tab are grid-level.
      if (editing) {
        const ctl = document.activeElement as HTMLElement;
        if (e.key === "Escape") {
          e.preventDefault();
          ctl.blur();
          activeTd?.focus();
        } else if (e.key === "Enter") {
          e.preventDefault();
          ctl.blur();
          select(r + 1, c);
        } else if (e.key === "Tab") {
          e.preventDefault();
          ctl.blur();
          select(r, c + (e.shiftKey ? -1 : 1), true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          select(r - 1, c);
          break;
        case "ArrowDown":
          e.preventDefault();
          select(r + 1, c);
          break;
        case "ArrowLeft":
          e.preventDefault();
          select(r, c - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          select(r, c + 1);
          break;
        case "Tab":
          e.preventDefault();
          select(r, c + (e.shiftKey ? -1 : 1));
          break;
        case "Enter":
        case "F2":
          e.preventDefault();
          select(r, c, true);
          break;
        case "Escape":
          setSel(null);
          break;
      }
    },
    [sel, select],
  );

  const cellProps = (r: number, c: number, extraClass?: string) => ({
    ref: (el: HTMLTableCellElement | null) => {
      if (el) tds.current.set(key(r, c), el);
      else tds.current.delete(key(r, c));
    },
    tabIndex: -1,
    // Mouse: a single click SELECTS the cell (Excel-style) without focusing
    // the editor — preventDefault stops the inner control stealing focus.
    // Touch: let the tap fall through so mobile users edit directly.
    onPointerDown: (e: React.PointerEvent<HTMLTableCellElement>) => {
      const td = tds.current.get(key(r, c));
      const alreadyEditingHere =
        !!td && td.contains(document.activeElement) && document.activeElement !== td;
      setSel({ r, c });
      if (e.pointerType === "mouse" && !alreadyEditingHere) {
        // Let a click land directly on an interactive control — a
        // <button>/<a> (e.g. the title's "open" affordance) or an inline
        // editor (<select>/<input>/<textarea>). Clicking a cell's *padding*
        // still just selects it, Excel-style; clicking the control edits it
        // in one click.
        const onActionEl = (e.target as HTMLElement).closest(
          "button,a,select,input,textarea,[data-editable]",
        );
        if (!onActionEl) {
          e.preventDefault();
          td?.focus();
        }
      }
    },
    onDoubleClick: () => select(r, c, true),
    className: [
      extraClass,
      sel && sel.r === r && sel.c === c ? "cell-active" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined,
  });

  return { sel, onKeyDown, cellProps, select, clear: () => setSel(null) };
}
