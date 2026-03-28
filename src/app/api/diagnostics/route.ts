import { NextRequest, NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    nowIso: new Date().toISOString(),
    host: request.headers.get("host") ?? null,
    forwardedProto: request.headers.get("x-forwarded-proto") ?? null,
    supabaseEnvConfigured: hasSupabaseEnv(),
  });
}

