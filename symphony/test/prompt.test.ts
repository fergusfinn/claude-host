import { describe, it, expect } from "vitest";
import { renderPrompt } from "../src/prompt.js";
import type { Issue } from "../src/types.js";

const testIssue: Issue = {
  id: "abc123",
  identifier: "MT-1",
  title: "Fix the bug",
  description: "Something is broken",
  priority: 1,
  state: "Todo",
  branch_name: null,
  url: "https://linear.app/test/issue/MT-1",
  labels: ["bug", "urgent"],
  blocked_by: [{ id: "def456", identifier: "MT-2", state: "In Progress" }],
  created_at: new Date("2025-01-01"),
  updated_at: new Date("2025-01-02"),
};

describe("renderPrompt", () => {
  it("renders issue fields", () => {
    const result = renderPrompt("Issue: {{ issue.identifier }} - {{ issue.title }}", testIssue, null);
    expect(result).toBe("Issue: MT-1 - Fix the bug");
  });

  it("renders attempt", () => {
    const result = renderPrompt("Attempt: {{ attempt }}", testIssue, 3);
    expect(result).toBe("Attempt: 3");
  });

  it("renders labels array", () => {
    const result = renderPrompt('{{ issue.labels | join: ", " }}', testIssue, null);
    expect(result).toBe("bug, urgent");
  });

  it("renders blocked_by", () => {
    const result = renderPrompt(
      "{% for b in issue.blocked_by %}{{ b.identifier }}{% endfor %}",
      testIssue,
      null,
    );
    expect(result).toBe("MT-2");
  });

  it("uses default prompt for empty template", () => {
    const result = renderPrompt("", testIssue, null);
    expect(result).toBe("You are working on an issue from Linear.");
  });

  it("handles null attempt in conditionals", () => {
    const template = "{% if attempt %}retry {{ attempt }}{% else %}first run{% endif %}";
    expect(renderPrompt(template, testIssue, null)).toBe("first run");
    expect(renderPrompt(template, testIssue, 2)).toBe("retry 2");
  });
});
