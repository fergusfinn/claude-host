import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSessionManager().getAllConfig(user.userId));
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const sm = getSessionManager();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      sm.setConfig(key, value, user.userId);
    }
  }
  return NextResponse.json(sm.getAllConfig(user.userId));
}
