import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  try {
    getSessionManager().reopen(name, user.userId);
    return NextResponse.json({ name });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
