import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSessionManager().list(user.userId));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { description, command, executor, mode } = await req.json();
    const session = await getSessionManager().create(description, command, executor, mode, user.userId);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
