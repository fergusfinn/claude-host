import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSessionManager().listExecutors(user.userId));
}
