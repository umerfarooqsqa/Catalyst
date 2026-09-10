import * as XLSX from "xlsx";

/**
 * Excel export. Any table view can hand its currently-visible (i.e.
 * filtered) rows here as an array of plain objects; column order follows
 * the key order of `columns`.
 *
 * `bugs` and `base_page` deliberately share heading names so exports
 * look consistent whichever sheet you came from (per CLAUDE.md).
 */
export function exportRows(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string }[],
  filename: string,
  sheetName = "Sheet1",
) {
  const data = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      const v = r[c.key];
      out[c.header] = Array.isArray(v) ? v.join(", ") : (v ?? "");
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(data, {
    header: columns.map((c) => c.header),
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(
    wb,
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
  );
}
