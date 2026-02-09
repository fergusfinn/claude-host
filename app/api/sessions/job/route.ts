import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function POST(req: NextRequest) {
  try {
    const { prompt, maxIterations, executor, skipPermissions } = await req.json();
    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }
    const session = await getSessionManager().createJob(prompt, maxIterations, executor, skipPermissions);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
