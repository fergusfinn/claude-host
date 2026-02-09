import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const sm = getSessionManager();
  const registry = (sm as any)._registry;
  const executor = (sm as any).getSessionExecutorId(name);

  if (!registry || executor === "local") {
    return NextResponse.json({ error: "Only works for remote sessions" }, { status: 400 });
  }

  try {
    const { rpcId } = await import("@/shared/protocol");
    const result = await registry.sendRpc(executor, {
      type: "diagnose_rich_session",
      id: rpcId(),
      name,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
