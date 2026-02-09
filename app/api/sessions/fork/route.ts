import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function POST(req: NextRequest) {
  try {
    const { source } = await req.json();
    if (!source) {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 },
      );
    }
    const session = await getSessionManager().fork(source);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
