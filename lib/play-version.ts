/**
 * Google Play vs the version QA is testing (projects.current_version), for the admin
 * My Queue's red cards (migration 0055). Mirrors aktrade utils/play_snapshot.py::verdict,
 * decided with the user (2026-10-26):
 *  - upcoming: a production draft / staged / halted rollout whose version differs from
 *    the portal's version -> it is about to reach users untested;
 *  - untested_live: production already ships a newer version than the portal's;
 *  - QA testing a version that isn't on Play yet is normal: no card.
 */

export type PlayVersionRow = {
  reachable: boolean;
  live_version: string | null;
  live_code: number | null;
  upcoming_version: string | null;
  upcoming_code: number | null;
  upcoming_track: string | null;
  upcoming_status: string | null;
  upcoming_fraction: number | string | null;
};

export type PlayMismatch = { kind: "upcoming" | "untested_live"; play: string; code: number | null };

/** "1.0.6" -> [1, 0, 6]; null when it isn't a dotted number. */
function parts(v: string | null | undefined): number[] | null {
  const s = String(v ?? "").trim().replace(/^v/i, "");
  return /^\d+(\.\d+)*$/.test(s) ? s.split(".").map(Number) : null;
}

/** <0, 0, >0 like a sort comparator; null when either isn't a dotted number. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const c = compareVersions(a, b);
  return c === null ? String(a ?? "").trim() === String(b ?? "").trim() : c === 0;
}

export function playVersionMismatch(row: PlayVersionRow, currentVersion: string | null): PlayMismatch | null {
  if (!row.reachable || !currentVersion) return null;
  if (row.upcoming_version && !sameVersion(row.upcoming_version, currentVersion)) {
    return { kind: "upcoming", play: row.upcoming_version, code: row.upcoming_code };
  }
  if (row.live_version && (compareVersions(row.live_version, currentVersion) ?? 0) > 0) {
    return { kind: "untested_live", play: row.live_version, code: row.live_code };
  }
  return null;
}
