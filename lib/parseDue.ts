/**
 * Fast "Due" entry. Turns a short human expression into an ISO timestamp
 * so a bug/task due date can be set by typing "3d" instead of clicking
 * through a calendar. An optional clock time is supported everywhere.
 *
 * Accepted:
 *   ""                     -> null (leave unchanged; the caller decides)
 *   "-" / "none" / "clear" -> null (explicitly clear)
 *   "3" / "3d" / "3 days"  -> 3 days from now, at 17:00 local
 *   "4h" / "90m"           -> 4 hours / 90 minutes from now (exact clock)
 *   "2w"                   -> 2 weeks from now, at 17:00
 *   "1mo"                  -> 1 month from now, at 17:00
 *   "today" / "tomorrow"   -> that day at 17:00
 *   "<any of the above> 9am" / "... 14:30"  -> same day, that clock time
 *   "2026-09-20" / "2026-09-20 14:30" / other Date-parseable strings
 *
 * Throws {@link DueParseError} (with a user-facing message) when it can't
 * make sense of the input.
 */

export class DueParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DueParseError";
  }
}

const CLEAR_WORDS = new Set(["-", "none", "clear", "x", "no", "never"]);
const DEFAULT_HOUR = 17; // 5pm — "due that day" means end of the workday

function to24(h: string, m: string | undefined, ap: string | undefined): [number, number] {
  let hour = parseInt(h, 10);
  const min = m ? parseInt(m, 10) : 0;
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59) throw new DueParseError(`"${h}:${m ?? "00"}" isn't a valid time.`);
  return [hour, min];
}

export function parseDue(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (CLEAR_WORDS.has(lower)) return null;

  // Split off a trailing clock time. A bare number ("3") is a day count,
  // not a time — only treat the tail as a clock when it carries a colon
  // or am/pm, or when there's a date part in front of it.
  let rest = lower;
  let clock: [number, number] | null = null;
  const t = lower.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/);
  if (t && (t[2] !== undefined || t[3] || (t.index ?? 0) > 0)) {
    clock = to24(t[1], t[2], t[3]);
    rest = lower.slice(0, t.index).trim();
  }

  const d = new Date();

  if (rest === "" || rest === "today" || rest === "eod" || rest === "tod") {
    // base stays today
  } else if (rest === "tomorrow" || rest === "tmr" || rest === "tom") {
    d.setDate(d.getDate() + 1);
  } else {
    const m = rest.match(
      /^(\d+(?:\.\d+)?)\s*(mo|months?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)?$/,
    );
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2] ?? "d";
      if (/^mo|^months?$/.test(unit)) {
        d.setMonth(d.getMonth() + Math.round(n));
      } else if (/^m$|^mins?|^minutes?/.test(unit)) {
        return new Date(d.getTime() + n * 60_000).toISOString();
      } else if (/^h/.test(unit)) {
        return new Date(d.getTime() + n * 3_600_000).toISOString();
      } else if (/^w/.test(unit)) {
        d.setDate(d.getDate() + n * 7);
      } else {
        d.setDate(d.getDate() + n);
      }
    } else {
      // Absolute date/datetime — hand it to the platform parser.
      const iso = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
      const abs = new Date(iso);
      if (Number.isNaN(abs.getTime())) {
        throw new DueParseError(
          `Couldn't read "${raw}" as a due date. Try "3d", "tomorrow 9am", or 2026-09-20.`,
        );
      }
      return abs.toISOString();
    }
  }

  const [h, mi] = clock ?? [DEFAULT_HOUR, 0];
  d.setHours(h, mi, 0, 0);
  return d.toISOString();
}

/** Short label for a due timestamp in a table cell, e.g. "in 3d", "5h ago". */
export function fmtDueShort(v: string | null | undefined): string {
  if (!v) return "";
  const ms = new Date(v).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = ms - Date.now();
  const past = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const hrs = Math.round(mins / 60);
  const days = Math.round(hrs / 24);
  let n: number;
  let unit: string;
  if (mins < 60) {
    n = mins;
    unit = "m";
  } else if (hrs < 48) {
    n = hrs;
    unit = "h";
  } else {
    n = days;
    unit = "d";
  }
  return past ? `${n}${unit} ago` : `in ${n}${unit}`;
}
