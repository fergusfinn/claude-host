import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFork = vi.fn();

vi.mock("@/lib/sessions", () => ({
  getSessionManager: () => ({
    fork: mockFork,
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockFork.mockReset();
});

describe("POST /api/sessions/fork", () => {
  it("forks a session and returns 201", async () => {
    const forked = { name: "fork-1", description: "forked from orig", mode: "terminal", alive: true };
    mockFork.mockReturnValue(forked);

    const req = new NextRequest("http://localhost/api/sessions/fork", {
      method: "POST",
      body: JSON.stringify({ source: "orig", name: "fork-1" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(forked);
    expect(mockFork).toHaveBeenCalledWith("orig", "fork-1");
  });

  it("returns 400 when source is missing", async () => {
    const req = new NextRequest("http://localhost/api/sessions/fork", {
      method: "POST",
      body: JSON.stringify({ name: "fork-1" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "source and name are required" });
  });

  it("returns 400 when name is missing", async () => {
    const req = new NextRequest("http://localhost/api/sessions/fork", {
      method: "POST",
      body: JSON.stringify({ source: "orig" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "source and name are required" });
  });

  it("returns 400 when fork throws", async () => {
    mockFork.mockImplementation(() => {
      throw new Error("Source not found");
    });

    const req = new NextRequest("http://localhost/api/sessions/fork", {
      method: "POST",
      body: JSON.stringify({ source: "orig", name: "fork-1" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Source not found" });
  });
});
