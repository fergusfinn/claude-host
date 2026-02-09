import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const text = await getSessionManager().snapshot(name, user.userId);
  return NextResponse.json({ text });
}
