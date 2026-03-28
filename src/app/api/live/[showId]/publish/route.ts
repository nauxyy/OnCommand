import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publishEvent, upsertCommunicationsConfig, upsertLiveState } from "@/lib/live/server-bus";

export const runtime = "nodejs";

const schema = z.object({
  type: z.enum(["line.advance", "line.set", "cue.standby", "cue.go", "message.sent", "presence.update", "communications.config"]),
  sourceRole: z.string().min(1),
  targetRoles: z.array(z.string().min(1)).min(1),
  payload: z.unknown(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ showId: string }> }) {
  const { showId } = await context.params;
  const json = await request.json();
  const parsed = schema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const input = parsed.data;

  if (input.type === "line.advance" || input.type === "line.set") {
    const payload = input.payload as {
      currentLineId?: number;
      currentAct?: number;
      currentWordIndex?: number;
      mode?: "auto" | "manual";
      currentSceneKey?: string;
    };
    const next = upsertLiveState(showId, {
      currentLineId: payload.currentLineId,
      currentAct: payload.currentAct,
      currentWordIndex: payload.currentWordIndex,
      mode: payload.mode,
      currentSceneKey: payload.currentSceneKey,
    });

    publishEvent({
      id: crypto.randomUUID(),
      showId,
      at: new Date().toISOString(),
      type: "line.set",
      sourceRole: input.sourceRole,
      targetRoles: input.targetRoles,
      payload: next,
    });

    return NextResponse.json({ ok: true });
  }

  if (input.type === "communications.config") {
    const payload = input.payload as { departments?: string[]; quickMessages?: string[] };
    const next = upsertCommunicationsConfig(showId, {
      departments: payload.departments,
      quickMessages: payload.quickMessages,
    });

    publishEvent({
      id: crypto.randomUUID(),
      showId,
      at: new Date().toISOString(),
      type: "communications.config",
      sourceRole: input.sourceRole,
      targetRoles: ["all"],
      payload: next,
    });

    return NextResponse.json({ ok: true });
  }

  publishEvent({
    id: crypto.randomUUID(),
    showId,
    at: new Date().toISOString(),
    type: input.type,
    sourceRole: input.sourceRole,
    targetRoles: input.targetRoles,
    payload: input.payload,
  });

  return NextResponse.json({ ok: true });
}
