import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function PUT(req: NextRequest) {
  const { names } = await req.json();
  if (!Array.isArray(names) || !names.every((n: unknown) => typeof n === "string")) {
    return NextResponse.json({ error: "names must be a string array" }, { status: 400 });
  }
  getSessionManager().reorder(names);
  return NextResponse.json({ ok: true });
}
