import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

const VALID_CONFIG_KEYS = new Set([
  "theme", "mode", "font", "richFont", "fontSize",
  "showHints", "shortcuts", "forkHooks",
]);

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(getSessionManager().getAllConfig(user.userId));
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const invalid = Object.keys(body).filter((k) => !VALID_CONFIG_KEYS.has(k));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Unknown config keys: ${invalid.join(", ")}` }, { status: 400 });
  }
  const sm = getSessionManager();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      sm.setConfig(key, value, user.userId);
    }
  }
  return NextResponse.json(sm.getAllConfig(user.userId));
}
