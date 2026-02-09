import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/sessions", () => ({
  getSessionManager: () => ({
    list: mockList,
    create: mockCreate,
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockList.mockReset();
  mockCreate.mockReset();
});

describe("GET /api/sessions", () => {
  it("returns the session list as JSON", async () => {
    const sessions = [
      { name: "s1", alive: true },
      { name: "s2", alive: false },
    ];
    mockList.mockReturnValue(sessions);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sessions);
  });

  it("returns empty array when no sessions", async () => {
    mockList.mockReturnValue([]);
    const res = await GET();
    expect(await res.json()).toEqual([]);
  });
});

describe("POST /api/sessions", () => {
  it("creates a session and returns 201", async () => {
    const created = { name: "bold-anvil", alive: true };
    mockCreate.mockReturnValue(created);

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({ description: "test", command: "bash" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    expect(mockCreate).toHaveBeenCalledWith("test", "bash", undefined, undefined);
  });

  it("creates a session with no description", async () => {
    const created = { name: "calm-falcon", alive: true };
    mockCreate.mockReturnValue(created);

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
  });

  it("returns 400 when create throws", async () => {
    mockCreate.mockImplementation(() => {
      throw new Error("Session already exists");
    });

    const req = new NextRequest("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Session already exists");
  });
});
