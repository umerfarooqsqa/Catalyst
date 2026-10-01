/**
 * REQ-2: extracts a release version number from release-notes text via
 * pattern matching -- deliberately not an LLM call (no API cost, no rate
 * limits, no network dependency, instant, and version numbers in release
 * notes are formulaic enough that regex handles them reliably).
 *
 * Strategy, in order of confidence:
 *   1. "version"/"release"/"ver" keyword immediately followed by a number,
 *      checked in the first ~500 chars (title/header area) first, then the
 *      whole document -- release notes almost always state the version
 *      prominently up top.
 *   2. A bare "vX.Y[.Z]" token, same header-first-then-whole-document order.
 *   3. Any bare "X.Y.Z" token anywhere, as a last resort.
 * Returns null (not an error) when nothing matches -- the caller falls
 * back to manual entry, never blocks on this.
 */
const HEADER_CHARS = 500;

const KEYWORD_VERSION = /\b(?:version|release|ver\.?)\s*[:#-]?\s*v?(\d+(?:\.\d+){1,3})\b/i;
const BARE_V_VERSION = /\bv(\d+(?:\.\d+){1,3})\b/i;
const LOOSE_VERSION = /\b(\d+\.\d+\.\d+)\b/;

export function parseVersionFromReleaseNotes(text: string): string | null {
  const header = text.slice(0, HEADER_CHARS);

  for (const source of [header, text]) {
    const match = source.match(KEYWORD_VERSION);
    if (match) return match[1];
  }
  for (const source of [header, text]) {
    const match = source.match(BARE_V_VERSION);
    if (match) return match[1];
  }
  const looseMatch = text.match(LOOSE_VERSION);
  return looseMatch ? looseMatch[1] : null;
}
