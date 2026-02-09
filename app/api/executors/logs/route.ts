import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET(req: NextRequest) {
  const registry = getSessionManager().registry;
  if (!registry) {
    return NextResponse.json([]);
  }

  const since = req.nextUrl.searchParams.get("since");
  const logs = registry.getLogs(since ? parseInt(since) : undefined);
  return NextResponse.json(logs);
}
