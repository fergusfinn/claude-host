import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET() {
  return NextResponse.json(getSessionManager().getAllConfig());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const sm = getSessionManager();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      sm.setConfig(key, value);
    }
  }
  return NextResponse.json(sm.getAllConfig());
}
