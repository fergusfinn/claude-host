import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { resolve } from "path";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  const resolved = resolve(filePath);

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 400 });
    }
    if (info.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (>2MB)" }, { status: 413 });
    }
    const content = await readFile(resolved, "utf-8");
    return NextResponse.json({ content, path: resolved });
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
