import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAllConfig = vi.fn();
const mockSetConfig = vi.fn();

vi.mock("@/lib/sessions", () => ({
  getSessionManager: () => ({
    getAllConfig: mockGetAllConfig,
    setConfig: mockSetConfig,
  }),
}));

import { GET, PUT } from "./route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockGetAllConfig.mockReset();
  mockSetConfig.mockReset();
});

describe("GET /api/config", () => {
  it("returns all config", async () => {
    mockGetAllConfig.mockReturnValue({ theme: "dark", font: "mono" });

    const res = await GET(new NextRequest("http://localhost/api/config"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: "dark", font: "mono" });
    expect(mockGetAllConfig).toHaveBeenCalledWith("local");
  });

  it("returns empty object when no config", async () => {
    mockGetAllConfig.mockReturnValue({});
    const res = await GET(new NextRequest("http://localhost/api/config"));
    expect(await res.json()).toEqual({});
  });
});

describe("PUT /api/config", () => {
  it("sets config values and returns all config", async () => {
    mockGetAllConfig.mockReturnValue({ theme: "dark", font: "mono" });

    const req = new NextRequest("http://localhost/api/config", {
      method: "PUT",
      body: JSON.stringify({ theme: "dark", font: "mono" }),
    });
    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(mockSetConfig).toHaveBeenCalledWith("theme", "dark", "local");
    expect(mockSetConfig).toHaveBeenCalledWith("font", "mono", "local");
    expect(await res.json()).toEqual({ theme: "dark", font: "mono" });
  });

  it("ignores non-string values", async () => {
    mockGetAllConfig.mockReturnValue({});

    const req = new NextRequest("http://localhost/api/config", {
      method: "PUT",
      body: JSON.stringify({ theme: "dark", fontSize: 123, font: null }),
    });
    await PUT(req);

    expect(mockSetConfig).toHaveBeenCalledTimes(1);
    expect(mockSetConfig).toHaveBeenCalledWith("theme", "dark", "local");
  });
});
