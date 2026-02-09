import { NextRequest, NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function POST(req: NextRequest) {
  try {
    const { name, prompt, maxIterations, executor, skipPermissions } = await req.json();
    if (!name || !prompt) {
      return NextResponse.json(
        { error: "name and prompt are required" },
        { status: 400 },
      );
    }
    const session = await getSessionManager().createJob(name, prompt, maxIterations, executor, skipPermissions);
    return NextResponse.json(session, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
