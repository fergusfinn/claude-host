import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function POST(req: NextRequest) {
  try {
    const { source, name } = await req.json();
    if (!source || !name) {
      return NextResponse.json(
        { error: "source and name are required" },
        { status: 400 },
      );
    }
    const session = getSessionManager().fork(source, name);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
