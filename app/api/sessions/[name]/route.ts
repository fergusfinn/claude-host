import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  // delete() already handles rich vs terminal cleanup internally
  await getSessionManager().delete(name);
  return new NextResponse(null, { status: 204 });
}
