import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const registry = getSessionManager().registry;
  if (!registry) {
    return NextResponse.json([]);
  }

  const since = req.nextUrl.searchParams.get("since");
  const logs = registry.getLogs(since ? parseInt(since) : undefined);
  return NextResponse.json(logs);
}
