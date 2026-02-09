import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { names } = await req.json();
  if (!Array.isArray(names) || !names.every((n: unknown) => typeof n === "string")) {
    return NextResponse.json({ error: "names must be a string array" }, { status: 400 });
  }
  getSessionManager().reorder(names, user.userId);
  return NextResponse.json({ ok: true });
}
