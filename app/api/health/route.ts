import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for Docker / load balancers. No DB round-trip. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
  });
}
