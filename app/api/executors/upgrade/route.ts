import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { executorId, reason } = body as { executorId?: string; reason?: string };

  const registry = getSessionManager().registry;
  if (!registry) {
    return NextResponse.json({ error: "No executor registry available" }, { status: 503 });
  }

  if (executorId) {
    try {
      registry.upgradeExecutor(executorId, { reason });
      return NextResponse.json({ upgraded: [executorId] });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
  }

  const upgraded = registry.upgradeAllExecutors({ reason });
  return NextResponse.json({ upgraded });
}
