import { NextResponse } from "next/server";
import { getSessionManager } from "@/lib/sessions";

export async function GET() {
  return NextResponse.json(getSessionManager().listExecutors());
}
