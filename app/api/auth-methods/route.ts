import { NextResponse } from "next/server";
import { getEnabledAuthMethods } from "@/lib/auth";

export function GET() {
  return NextResponse.json(getEnabledAuthMethods());
}
