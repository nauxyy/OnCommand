import { NextResponse } from "next/server";
import { resolveShowIdFromLiveAccessCode } from "@/lib/live/server-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const showId = resolveShowIdFromLiveAccessCode(code);
  if (!showId) {
    return NextResponse.json({ error: "Code not found" }, { status: 404 });
  }
  return NextResponse.json({ showId });
}

