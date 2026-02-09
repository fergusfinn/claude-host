import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDelete = vi.fn();

vi.mock("@/lib/sessions", () => ({
  getSessionManager: () => ({
    delete: mockDelete,
  }),
}));

import { DELETE } from "./route";
import { NextRequest } from "next/server";

beforeEach(() => {
  mockDelete.mockReset();
});

describe("DELETE /api/sessions/[name]", () => {
  it("deletes a session and returns 204", async () => {
    const req = new NextRequest("http://localhost/api/sessions/my-sess", {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: Promise.resolve({ name: "my-sess" }) });

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith("my-sess", "local");
  });
});
