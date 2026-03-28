import { NextRequest } from "next/server";
import { createEventStream } from "@/lib/live/server-bus";
import type { DepartmentRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ showId: string }> }) {
  const { showId } = await context.params;
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
  const role = (url.searchParams.get("role") ?? "all") as DepartmentRole | "all";

  const stream = createEventStream(showId, clientId, role);

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
