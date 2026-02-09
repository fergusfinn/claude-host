import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";
import { getAuthUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { prompt, maxIterations, executor, skipPermissions } = await req.json();
    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }
    const session = await getSessionManager().createJob(prompt, maxIterations, executor, skipPermissions, user.userId);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
