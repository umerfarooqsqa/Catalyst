"use client";

import { useEffect, useState } from "react";
import { fmtTimestamp, fmtTimestampFull } from "@/lib/format";

/**
 * A timestamp in the viewer's own time zone. The server renders in UTC (Cloudflare), and a
 * mismatched hydration keeps the server's text, so the text is filled in after mount instead.
 * The tooltip shows the full date, seconds and time zone.
 */
export default function LocalTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const [text, setText] = useState<{ short: string; full: string } | null>(null);
  useEffect(() => {
    setText({ short: fmtTimestamp(value), full: fmtTimestampFull(value) });
  }, [value]);
  if (!value) return <span className={className}>—</span>;
  return (
    <time dateTime={value} title={text?.full} className={className}>
      {text?.short ?? " "}
    </time>
  );
}
