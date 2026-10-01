// Makes every app icon from one square logo (PNG/SVG, ideally 1024x1024).
//   node scripts/make-icons.mjs path/to/logo.png
// Writes to public/:
//   icons/icon-192.png, icons/icon-512.png   the logo as is ("any" purpose)
//   icons/icon-maskable-512.png              logo at 70% on the theme colour, safe for round/squircle masks
//   icons/badge-72.png                       white silhouette on transparent (notification badge), cut from
//                                            the logo's transparency or, for a logo on white, its dark pixels
//   icons/apple-touch-icon.png               180px on white, for iOS (app/layout.tsx links it)
// The manifest (public/manifest.webmanifest), sw.js and the Android app (android-app/twa-manifest.json)
// already point at these paths.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THEME = "#217346";
const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/make-icons.mjs <logo.png|svg>");
  process.exit(1);
}
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
await mkdir(path.join(pub, "icons"), { recursive: true });

const meta = await sharp(src).metadata();
if (meta.width && meta.height && Math.abs(meta.width - meta.height) > 2) {
  console.warn(`warning: the logo is ${meta.width}x${meta.height}, not square; it is fitted inside the square.`);
}
const fit = (size, background = { r: 0, g: 0, b: 0, alpha: 0 }) =>
  sharp(src, { density: 384 }).resize(size, size, { fit: "contain", background }).png();

await fit(192).toFile(path.join(pub, "icons", "icon-192.png"));
await fit(512).toFile(path.join(pub, "icons", "icon-512.png"));

// A logo drawn on white (no transparency) keeps its white background in the maskable icon; one
// with transparency sits on the theme colour.
const opaque = !meta.hasAlpha || (await sharp(src).stats()).isOpaque;
const inner = await fit(Math.round(512 * 0.7)).toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: opaque ? "#ffffff" : THEME } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(path.join(pub, "icons", "icon-maskable-512.png"));

// Badge = the logo's shape as a white silhouette: its transparency, or for a logo on white every
// pixel clearly darker than the background.
let alpha;
if (opaque) {
  const { data } = await fit(72, "#ffffff").flatten({ background: "#ffffff" }).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  alpha = Buffer.from(data.map((v) => (v < 215 ? 255 : 0)));
} else {
  alpha = await fit(72).ensureAlpha().extractChannel("alpha").raw().toBuffer();
}
await sharp(Buffer.alloc(72 * 72 * 3, 255), { raw: { width: 72, height: 72, channels: 3 } })
  .joinChannel(alpha, { raw: { width: 72, height: 72, channels: 1 } })
  .png()
  .toFile(path.join(pub, "icons", "badge-72.png"));
if (opaque) console.log("note: the logo is on white; the maskable icon keeps white and the badge is cut from its dark pixels.");

const touch = await fit(Math.round(180 * 0.8)).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: "#ffffff" } })
  .composite([{ input: touch, gravity: "center" }])
  .png()
  .toFile(path.join(pub, "icons", "apple-touch-icon.png"));

console.log("icons written to public/icons/");
