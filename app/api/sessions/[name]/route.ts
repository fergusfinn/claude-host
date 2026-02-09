import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  // delete() already handles rich vs terminal cleanup internally
  await getSessionManager().delete(name, user.userId);
  return new NextResponse(null, { status: 204 });
}
