import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSessionManager().listExecutorKeys(user.userId));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name: string = body.name || "";
  const expiresInDays: number | undefined = body.expiresInDays;

  const expiresAt = expiresInDays
    ? Math.floor(Date.now() / 1000) + expiresInDays * 86400
    : null;

  const result = getSessionManager().createExecutorKey(user.userId, name, expiresAt);

  return NextResponse.json({
    id: result.id,
    name,
    token: result.token,
    key_prefix: result.key_prefix,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: expiresAt,
  });
}
