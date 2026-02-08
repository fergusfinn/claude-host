import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const text = await getSessionManager().snapshot(name);
  return NextResponse.json({ text });
}
