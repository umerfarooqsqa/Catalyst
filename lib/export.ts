import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Excel export. Any table view can hand its currently-visible (i.e.
 * filtered) rows here as an array of plain objects; column order follows
 * the key order of `columns`.
 *
 * `bugs` and `base_page` deliberately share heading names so exports
 * look consistent whichever sheet you came from (per CLAUDE.md).
 *
 * Written with ExcelJS (loaded only when someone exports) so the sheet is
 * formatted: styled, frozen, filterable header, sized and wrapped columns.
 * Rows can also carry screenshots. The main sheet shows a preview of the
 * first one plus a link, and a "Screenshots" sheet holds every image
 * full-size, one per row.
 */

export type ExportColumn = { key: string; header: string; width?: number };

/** One image to embed, already fetched and sized (see loadScreenshots). */
export type SheetImage = {
  fileName: string;
  uploadedAt: string;
  dataUrl: string; // data:image/jpeg;base64,...
  width: number;
  height: number;
};

const HEADER_FILL = "FF1E3A5F";
const BORDER = { style: "thin" as const, color: { argb: "FFD0D7E2" } };
const PX_TO_PT = 0.75; // Excel row heights are in points

// Long free-text columns get more room; everything else a compact default.
function defaultWidth(key: string): number {
  if (/description|steps|notes|content/.test(key)) return 55;
  if (/title|requirement|linked/.test(key)) return 40;
  return 16;
}

function fit(w: number, h: number, maxW: number, maxH: number) {
  const s = Math.min(maxW / w, maxH / h, 1);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function cellValue(v: unknown): string | number {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return v;
  return v == null ? "" : String(v);
}

export async function exportRows(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  filename: string,
  sheetName = "Sheet1",
  opts: { images?: SheetImage[][]; imageLabelKey?: string } = {},
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Catalyst";
  wb.created = new Date();

  const images = opts.images;
  const withImages = !!images && images.some((l) => l.length > 0);
  const sheet = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    ...columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? defaultWidth(c.key) })),
    ...(withImages
      ? [
          { header: "Screenshots", key: "__shots", width: 16 },
          { header: "Preview", key: "__preview", width: 18 },
        ]
      : []),
  ];

  const header = sheet.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  // Screenshots sheet first (so the main sheet can link to each bug's first image row).
  const firstShotRow = new Map<number, number>();
  const shots = withImages ? wb.addWorksheet("Screenshots", { views: [{ state: "frozen", ySplit: 1 }] }) : null;
  if (shots && images) {
    shots.columns = [
      { header: sheetName === "Bugs" ? "Bug" : "Row", key: "label", width: 40 },
      { header: "File", key: "file", width: 36 },
      { header: "Uploaded", key: "uploaded", width: 20 },
      { header: "Screenshot", key: "image", width: 52 },
    ];
    shots.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    });
    let r = 2;
    images.forEach((list, i) => {
      for (const img of list) {
        if (!firstShotRow.has(i)) firstShotRow.set(i, r);
        const box = fit(img.width, img.height, 360, 530); // 530 px fits in Excel's 409 pt row limit
        const row = shots.getRow(r);
        row.values = {
          label: cellValue(rows[i][opts.imageLabelKey ?? columns[0].key]),
          file: img.fileName,
          uploaded: img.uploadedAt,
        };
        row.height = Math.min(409, box.height * PX_TO_PT + 8); // Excel caps rows at 409 pt
        row.alignment = { vertical: "top", wrapText: true };
        const id = wb.addImage({ base64: img.dataUrl, extension: "jpeg" });
        shots.addImage(id, { tl: { col: 3.05, row: r - 1 + 0.02 }, ext: box, editAs: "oneCell" });
        r++;
      }
    });
  }

  rows.forEach((src, i) => {
    const values: Record<string, string | number> = {};
    for (const c of columns) values[c.key] = cellValue(src[c.key]);
    const row = sheet.addRow(values);
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    });
    if (i % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
      });
    }
    const list = images?.[i] ?? [];
    if (withImages && list.length) {
      const target = firstShotRow.get(i);
      const shotsCell = row.getCell("__shots");
      shotsCell.value = {
        text: `${list.length} screenshot${list.length > 1 ? "s" : ""} →`,
        hyperlink: `#'Screenshots'!D${target}`,
      };
      shotsCell.font = { color: { argb: "FF1D4ED8" }, underline: true };
      const thumb = fit(list[0].width, list[0].height, 110, 150);
      row.height = Math.max(row.height ?? 15, thumb.height * PX_TO_PT + 8);
      const id = wb.addImage({ base64: list[0].dataUrl, extension: "jpeg" });
      const col = columns.length + 1; // 0-based index of the Preview column
      sheet.addImage(id, { tl: { col: col + 0.05, row: row.number - 1 + 0.05 }, ext: thumb, editAs: "oneCell" });
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Several tables in one workbook, one formatted sheet each (same header style, borders and
 * banding as exportRows, no images). Used by the auto-test report page.
 */
export async function exportWorkbook(
  sheets: { name: string; rows: Record<string, unknown>[]; columns: ExportColumn[] }[],
  filename: string,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Catalyst";
  wb.created = new Date();
  for (const s of sheets) {
    const sheet = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? defaultWidth(c.key) }));
    const header = sheet.getRow(1);
    header.height = 22;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    });
    if (s.columns.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    s.rows.forEach((src, i) => {
      const values: Record<string, string | number> = {};
      for (const c of s.columns) values[c.key] = cellValue(src[c.key]);
      const row = sheet.addRow(values);
      row.alignment = { vertical: "top", wrapText: true };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
      });
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;
export const MAX_EXPORT_IMAGES = 300; // keeps the file (and the browser) a sensible size

/** Downscales and re-encodes as JPEG: phone PNGs are ~600 KB each at full size. */
async function toSheetImage(blob: Blob): Promise<Omit<SheetImage, "fileName" | "uploadedAt">> {
  const bmp = await createImageBitmap(blob);
  const size = fit(bmp.width, bmp.height, 720, 1080); // 2x the sheet box, so text stays sharp
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bmp, 0, 0, size.width, size.height);
  bmp.close();
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: size.width, height: size.height };
}

/**
 * The image attachments of each bug (in the order of `bugIds`), fetched from
 * storage and prepared for embedding. Non-image attachments are skipped.
 * Returns the lists plus how many images were left out over the cap or
 * because they couldn't be read.
 */
export async function loadBugScreenshots(
  supabase: SupabaseClient,
  bugIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ images: SheetImage[][]; skipped: number }> {
  const rows: { bug_id: string; file_name: string; file_path: string; created_at: string }[] = [];
  for (let i = 0; i < bugIds.length; i += 100) {
    const { data, error } = await supabase
      .from("attachments")
      .select("bug_id, file_name, file_path, created_at")
      .in("bug_id", bugIds.slice(i, i + 100))
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  const all = rows.filter((r) => IMAGE_FILE.test(r.file_name));
  const wanted = all.slice(0, MAX_EXPORT_IMAGES);
  const results: (SheetImage | null)[] = new Array(wanted.length).fill(null);
  let done = 0;
  onProgress?.(0, wanted.length);

  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const i = next++;
      const r = wanted[i];
      try {
        const { data, error } = await supabase.storage.from("attachments").download(r.file_path);
        if (error || !data) throw error ?? new Error("empty");
        const img = await toSheetImage(data);
        results[i] = { ...img, fileName: r.file_name, uploadedAt: new Date(r.created_at).toLocaleString() };
      } catch {
        // unreadable image: counted in `skipped`
      }
      onProgress?.(++done, wanted.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  // Per bug, in upload order (wanted is ordered by created_at).
  const byBug = new Map<string, SheetImage[]>();
  wanted.forEach((r, i) => {
    const img = results[i];
    if (img) byBug.set(r.bug_id, [...(byBug.get(r.bug_id) ?? []), img]);
  });
  const images = bugIds.map((id) => byBug.get(id) ?? []);
  const failed = results.filter((x) => x === null).length;
  return { images, skipped: all.length - wanted.length + failed };
}
