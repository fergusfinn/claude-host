import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSnapshot = vi.fn();

vi.mock("@/lib/sessions", () => ({
  getSessionManager: () => ({
    snapshot: mockSnapshot,
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockSnapshot.mockReset();
});

describe("GET /api/sessions/[name]/snapshot", () => {
  it("returns snapshot text", async () => {
    mockSnapshot.mockReturnValue("$ hello world\n");

    const req = new NextRequest("http://localhost/api/sessions/my-sess/snapshot");
    const res = await GET(req, { params: Promise.resolve({ name: "my-sess" }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "$ hello world\n" });
    expect(mockSnapshot).toHaveBeenCalledWith("my-sess");
  });

  it("returns placeholder for non-running session", async () => {
    mockSnapshot.mockReturnValue("[session not running]");

    const req = new NextRequest("http://localhost/api/sessions/dead/snapshot");
    const res = await GET(req, { params: Promise.resolve({ name: "dead" }) });

    expect(await res.json()).toEqual({ text: "[session not running]" });
  });
});
