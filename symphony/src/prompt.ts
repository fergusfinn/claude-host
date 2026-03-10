// Prompt template rendering — spec §5.4, §12

import { Liquid } from "liquidjs";
import { SymphonyError, type Issue } from "./types.js";

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

const DEFAULT_PROMPT = "You are working on an issue from Linear.";

export function renderPrompt(template: string, issue: Issue, attempt: number | null): string {
  const effectiveTemplate = template.trim() || DEFAULT_PROMPT;

  // Convert issue to plain object with string-safe keys for Liquid
  const issueObj: Record<string, unknown> = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branch_name ?? "",
    url: issue.url ?? "",
    labels: issue.labels,
    blocked_by: issue.blocked_by.map((b) => ({
      id: b.id ?? "",
      identifier: b.identifier ?? "",
      state: b.state ?? "",
    })),
    created_at: issue.created_at?.toISOString() ?? "",
    updated_at: issue.updated_at?.toISOString() ?? "",
  };

  try {
    return engine.parseAndRenderSync(effectiveTemplate, {
      issue: issueObj,
      attempt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("undefined variable") || msg.includes("is not defined")) {
      throw new SymphonyError("template_render_error", `Unknown variable in template: ${msg}`);
    }
    throw new SymphonyError("template_parse_error", `Template error: ${msg}`);
  }
}
