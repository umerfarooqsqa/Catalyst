export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const mins = Math.round(abs / 60000);
  if (mins < 60) return rtf.format(Math.sign(diff) * mins, "minute");
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return rtf.format(Math.sign(diff) * hrs, "hour");
  const days = Math.round(hrs / 24);
  return rtf.format(Math.sign(diff) * days, "day");
}

export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
