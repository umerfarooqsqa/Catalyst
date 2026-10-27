import { inflateRawSync, constants } from "node:zlib";
import { gcall } from "@/lib/monitor/google";

/**
 * A build's real min/target SDK, read from Google Play's own copy of it (migration 0059).
 * Google has no API field for the target SDK, but Play serves the APKs it generated from an
 * app bundle (generatedApks, allowed with "View app information"). AndroidManifest.xml is the
 * first entry of those APKs, so only the first few KB are read and the rest of the download is
 * cancelled: a 136 MB base APK costs ~10 KB.
 */

const PUB = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const TARGET_SDK = 0x01010270; // android:targetSdkVersion
const MIN_SDK = 0x0101020c; // android:minSdkVersion
const MAX_READ = 4 * 1024 * 1024;

export type BuildSdk = { minSdk: number | null; targetSdk: number | null };

/** AndroidManifest.xml (still binary XML) from the start of an APK; "more" = need more bytes; null = not found. */
export function manifestFromApkPrefix(buf: Uint8Array): Uint8Array | "more" | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  while (true) {
    if (off + 30 > buf.length) return "more";
    if (v.getUint32(off, true) !== 0x04034b50) return null; // past the local entries
    const flags = v.getUint16(off + 6, true);
    const method = v.getUint16(off + 8, true);
    const csize = v.getUint32(off + 18, true);
    const nameLen = v.getUint16(off + 26, true);
    const extraLen = v.getUint16(off + 28, true);
    if (off + 30 + nameLen > buf.length) return "more";
    const name = new TextDecoder().decode(buf.subarray(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    const sizeKnown = !(flags & 0x08) || csize > 0;
    if (name === "AndroidManifest.xml") {
      if (!sizeKnown) {
        // sizes follow the data: inflate what we have; a raw deflate stream ends by itself
        if (method !== 8 || buf.length - start < 64 * 1024) return buf.length >= MAX_READ ? null : "more";
        return inflateRawSync(buf.subarray(start), { finishFlush: constants.Z_SYNC_FLUSH });
      }
      if (start + csize > buf.length) return "more";
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      return null;
    }
    if (!sizeKnown) return null; // can't skip an entry of unknown size
    off = start + csize;
  }
}

/** minSdkVersion / targetSdkVersion from Android binary XML (matched by attribute resource id). */
export function sdkFromManifest(axml: Uint8Array): BuildSdk {
  const v = new DataView(axml.buffer, axml.byteOffset, axml.byteLength);
  const out: BuildSdk = { minSdk: null, targetSdk: null };
  if (axml.length < 8 || v.getUint16(0, true) !== 0x0003) return out;
  let ids: number[] = [];
  let off = v.getUint16(2, true);
  while (off + 8 <= axml.length) {
    const type = v.getUint16(off, true);
    const hsize = v.getUint16(off + 2, true);
    const size = v.getUint32(off + 4, true);
    if (size < 8 || off + size > axml.length) break;
    if (type === 0x0180) {
      ids = [];
      for (let p = off + hsize; p + 4 <= off + size; p += 4) ids.push(v.getUint32(p, true));
    } else if (type === 0x0102) {
      const ext = off + hsize;
      const attrStart = v.getUint16(ext + 8, true);
      const attrSize = v.getUint16(ext + 10, true);
      const count = v.getUint16(ext + 12, true);
      for (let i = 0; i < count; i++) {
        const a = ext + attrStart + i * attrSize;
        if (a + 20 > off + size) break;
        const id = ids[v.getUint32(a + 4, true)];
        const dataType = axml[a + 15];
        if ((id === TARGET_SDK || id === MIN_SDK) && (dataType === 0x10 || dataType === 0x11)) {
          if (id === TARGET_SDK) out.targetSdk = v.getUint32(a + 16, true);
          else out.minSdk = v.getUint32(a + 16, true);
        }
      }
      if (out.targetSdk !== null) return out;
    }
    off += size;
  }
  return out;
}

type GeneratedApks = {
  generatedApks?: {
    generatedUniversalApk?: { downloadId?: string };
    generatedSplitApks?: { downloadId?: string; moduleName?: string; splitId?: string; variantId?: number }[];
  }[];
};

/** Reads one build's SDK levels from Play. Throws with a plain reason when it can't. */
export async function readBuildSdk(token: string, pkg: string, versionCode: number): Promise<BuildSdk> {
  const list = await gcall<GeneratedApks>(token, `${PUB}/${pkg}/generatedApks/${versionCode}`);
  const set = list.generatedApks?.[0];
  // the base module's master split (no splitId) holds the full manifest; else the universal APK
  const base = (set?.generatedSplitApks ?? [])
    .filter((s) => s.moduleName === "base" && !s.splitId && s.downloadId)
    .sort((a, b) => (b.variantId ?? 0) - (a.variantId ?? 0))[0];
  const id = base?.downloadId ?? set?.generatedUniversalApk?.downloadId;
  if (!id) throw new Error(`Play has no generated APKs for build ${versionCode} (uploaded as an APK, not an app bundle?)`);
  const res = await fetch(`${PUB}/${pkg}/generatedApks/${versionCode}/downloads/${encodeURIComponent(id)}:download?alt=media`, {
    headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-262143" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok || !res.body) throw new Error(`downloading build ${versionCode} from Play failed (HTTP ${res.status})`);
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf);
        next.set(value, buf.length);
        buf = next;
      }
      const m = manifestFromApkPrefix(buf);
      if (m === null) throw new Error(`no AndroidManifest.xml at the start of build ${versionCode}'s APK`);
      if (m !== "more") {
        const sdk = sdkFromManifest(m);
        if (sdk.targetSdk === null) throw new Error(`build ${versionCode}'s manifest has no targetSdkVersion`);
        return sdk;
      }
      if (done || buf.length >= MAX_READ) throw new Error(`build ${versionCode}'s manifest wasn't found in the first ${buf.length} bytes`);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
