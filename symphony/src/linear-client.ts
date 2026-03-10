// Linear GraphQL API client — spec §11

import { logger } from "./logger.js";
import { SymphonyError, type Issue, type BlockerRef } from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const NETWORK_TIMEOUT_MS = 30000;

export class LinearClient {
  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {}

  async fetchCandidateIssues(projectSlug: string, activeStates: string[]): Promise<Issue[]> {
    if (!projectSlug) {
      throw new SymphonyError("missing_tracker_project_slug", "project_slug is required");
    }
    if (!this.apiKey) {
      throw new SymphonyError("missing_tracker_api_key", "API key is required");
    }

    const allIssues: Issue[] = [];
    let cursor: string | null = null;

    while (true) {
      const query = `
        query($projectSlug: String!, $states: [String!]!, $first: Int!, $after: String) {
          issues(
            filter: {
              project: { slugId: { eq: $projectSlug } }
              state: { name: { in: $states } }
            }
            first: $first
            after: $after
            orderBy: createdAt
          ) {
            nodes {
              id
              identifier
              title
              description
              priority
              state { name }
              branchName
              url
              labels { nodes { name } }
              relations(first: 50) {
                nodes {
                  type
                  relatedIssue {
                    id
                    identifier
                    state { name }
                  }
                }
              }
              inverseRelations(first: 50) {
                nodes {
                  type
                  issue {
                    id
                    identifier
                    state { name }
                  }
                }
              }
              createdAt
              updatedAt
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        projectSlug,
        states: activeStates,
        first: DEFAULT_PAGE_SIZE,
        ...(cursor ? { after: cursor } : {}),
      };

      const result = await this.graphql(query, variables);
      const issues = result.data?.issues;
      if (!issues) {
        throw new SymphonyError("linear_unknown_payload", "Unexpected response shape from Linear API");
      }

      for (const node of issues.nodes) {
        allIssues.push(normalizeIssue(node));
      }

      if (issues.pageInfo.hasNextPage) {
        if (!issues.pageInfo.endCursor) {
          throw new SymphonyError("linear_missing_end_cursor", "Pagination endCursor missing");
        }
        cursor = issues.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return allIssues;
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Array<{ id: string; state: string }>> {
    if (ids.length === 0) return [];

    const query = `
      query($ids: [ID!]) {
        issues(filter: { id: { in: $ids } }) {
          nodes {
            id
            identifier
            state { name }
          }
        }
      }
    `;

    const result = await this.graphql(query, { ids });
    const nodes = result.data?.issues?.nodes;
    if (!Array.isArray(nodes)) {
      throw new SymphonyError("linear_unknown_payload", "Unexpected response shape for issue state lookup");
    }

    return nodes
      .filter((n: any) => n && n.id && n.state)
      .map((n: any) => ({
        id: n.id,
        state: n.state.name,
      }));
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) return [];

    const allIssues: Issue[] = [];
    let cursor: string | null = null;

    while (true) {
      const query = `
        query($states: [String!]!, $first: Int!, $after: String) {
          issues(
            filter: {
              state: { name: { in: $states } }
            }
            first: $first
            after: $after
          ) {
            nodes {
              id
              identifier
              title
              state { name }
              createdAt
              updatedAt
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        states: stateNames,
        first: DEFAULT_PAGE_SIZE,
        ...(cursor ? { after: cursor } : {}),
      };

      const result = await this.graphql(query, variables);
      const issues = result.data?.issues;
      if (!issues) {
        throw new SymphonyError("linear_unknown_payload", "Unexpected response shape");
      }

      for (const node of issues.nodes) {
        allIssues.push(normalizeIssue(node));
      }

      if (issues.pageInfo.hasNextPage) {
        if (!issues.pageInfo.endCursor) {
          throw new SymphonyError("linear_missing_end_cursor", "Pagination endCursor missing");
        }
        cursor = issues.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return allIssues;
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<any> {
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (e) {
      throw new SymphonyError(
        "linear_api_request",
        `Linear API request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!response.ok) {
      throw new SymphonyError("linear_api_status", `Linear API returned ${response.status}`);
    }

    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new SymphonyError("linear_unknown_payload", "Failed to parse Linear API response as JSON");
    }

    if (body.errors && body.errors.length > 0) {
      const messages = body.errors.map((e: any) => e.message).join("; ");
      logger.error("Linear GraphQL errors", { errors: messages });
      throw new SymphonyError("linear_graphql_errors", `GraphQL errors: ${messages}`);
    }

    return body;
  }
}

function normalizeIssue(node: any): Issue {
  // Labels → lowercase
  const labels: string[] = (node.labels?.nodes ?? []).map((l: any) => String(l.name).toLowerCase());

  // Blocked-by: inverse relations where type is "blocks"
  // If issue A blocks issue B, then in B's inverseRelations we find type="blocks" pointing to A
  const blockedBy: BlockerRef[] = [];
  for (const rel of node.inverseRelations?.nodes ?? []) {
    if (rel.type === "blocks" && rel.issue) {
      blockedBy.push({
        id: rel.issue.id ?? null,
        identifier: rel.issue.identifier ?? null,
        state: rel.issue.state?.name ?? null,
      });
    }
  }
  // Also check forward relations where this issue is blocked
  for (const rel of node.relations?.nodes ?? []) {
    if (rel.type === "blocks" && rel.relatedIssue) {
      // This issue blocks relatedIssue, so relatedIssue is NOT a blocker of this issue
      // We want the opposite: things that block us
    }
  }

  // Priority: integer or null
  const priority = typeof node.priority === "number" && Number.isInteger(node.priority) ? node.priority : null;

  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title ?? "",
    description: node.description ?? null,
    priority,
    state: node.state?.name ?? "",
    branch_name: node.branchName ?? null,
    url: node.url ?? null,
    labels,
    blocked_by: blockedBy,
    created_at: node.createdAt ? new Date(node.createdAt) : null,
    updated_at: node.updatedAt ? new Date(node.updatedAt) : null,
  };
}
