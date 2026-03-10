import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LinearClient } from "../src/linear-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function graphqlResponse(data: any) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function graphqlError(errors: Array<{ message: string }>) {
  return new Response(JSON.stringify({ errors }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const client = new LinearClient("https://api.linear.app/graphql", "test-key");

describe("LinearClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("fetchCandidateIssues", () => {
    it("fetches and normalizes issues", async () => {
      mockFetch.mockResolvedValueOnce(
        graphqlResponse({
          issues: {
            nodes: [
              {
                id: "id1",
                identifier: "MT-1",
                title: "Test issue",
                description: "A description",
                priority: 2,
                state: { name: "Todo" },
                branchName: null,
                url: "https://linear.app/test/MT-1",
                labels: { nodes: [{ name: "Bug" }, { name: "URGENT" }] },
                relations: { nodes: [] },
                inverseRelations: { nodes: [] },
                createdAt: "2025-01-01T00:00:00Z",
                updatedAt: "2025-01-02T00:00:00Z",
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }),
      );

      const issues = await client.fetchCandidateIssues("proj", ["Todo"]);
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("id1");
      expect(issues[0].identifier).toBe("MT-1");
      expect(issues[0].labels).toEqual(["bug", "urgent"]); // lowercase
      expect(issues[0].priority).toBe(2);
    });

    it("paginates across multiple pages", async () => {
      mockFetch
        .mockResolvedValueOnce(
          graphqlResponse({
            issues: {
              nodes: [{ id: "id1", identifier: "MT-1", title: "A", state: { name: "Todo" }, createdAt: null, updatedAt: null }],
              pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            },
          }),
        )
        .mockResolvedValueOnce(
          graphqlResponse({
            issues: {
              nodes: [{ id: "id2", identifier: "MT-2", title: "B", state: { name: "Todo" }, createdAt: null, updatedAt: null }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }),
        );

      const issues = await client.fetchCandidateIssues("proj", ["Todo"]);
      expect(issues).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on GraphQL errors", async () => {
      mockFetch.mockResolvedValueOnce(graphqlError([{ message: "Not found" }]));
      await expect(client.fetchCandidateIssues("proj", ["Todo"])).rejects.toThrow("GraphQL errors");
    });

    it("throws on non-200 status", async () => {
      mockFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
      await expect(client.fetchCandidateIssues("proj", ["Todo"])).rejects.toThrow("401");
    });
  });

  describe("fetchIssueStatesByIds", () => {
    it("returns empty for empty input", async () => {
      const result = await client.fetchIssueStatesByIds([]);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches states for given IDs", async () => {
      mockFetch.mockResolvedValueOnce(
        graphqlResponse({
          issues: {
            nodes: [
              { id: "id1", identifier: "MT-1", state: { name: "Done" } },
              { id: "id2", identifier: "MT-2", state: { name: "In Progress" } },
            ],
          },
        }),
      );

      const result = await client.fetchIssueStatesByIds(["id1", "id2"]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "id1", state: "Done" });
    });
  });

  describe("fetchIssuesByStates", () => {
    it("returns empty for empty states", async () => {
      const result = await client.fetchIssuesByStates([]);
      expect(result).toEqual([]);
    });
  });
});
