import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET() {
  return NextResponse.json(getSessionManager().list());
}

export async function POST(req: NextRequest) {
  try {
    const { name, description, command, executor, mode } = await req.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const session = await getSessionManager().create(name, description, command, executor, mode);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
