import { describe, it, expect } from "vitest";
import { parseWorkflow } from "../src/workflow-loader.js";
import { SymphonyError } from "../src/types.js";

function expectCode(fn: () => void, code: string) {
  try {
    fn();
    expect.fail("Expected SymphonyError");
  } catch (e) {
    expect(e).toBeInstanceOf(SymphonyError);
    expect((e as SymphonyError).code).toBe(code);
  }
}

describe("parseWorkflow", () => {
  it("parses YAML front matter and prompt body", () => {
    const content = `---
tracker:
  kind: linear
  project_slug: test
---
Hello {{ issue.title }}`;

    const result = parseWorkflow(content);
    expect(result.config).toEqual({ tracker: { kind: "linear", project_slug: "test" } });
    expect(result.prompt_template).toBe("Hello {{ issue.title }}");
  });

  it("treats entire file as prompt when no front matter", () => {
    const result = parseWorkflow("Just a prompt");
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe("Just a prompt");
  });

  it("handles empty front matter as empty config", () => {
    const result = parseWorkflow("---\n---\nPrompt here");
    expect(result.config).toEqual({});
    expect(result.prompt_template).toBe("Prompt here");
  });

  it("throws on non-map front matter", () => {
    expectCode(() => parseWorkflow("---\n- list item\n---\nPrompt"), "workflow_front_matter_not_a_map");
  });

  it("throws on unterminated front matter", () => {
    expectCode(() => parseWorkflow("---\nkey: value\nno closing"), "workflow_parse_error");
  });

  it("throws on invalid YAML", () => {
    expectCode(() => parseWorkflow("---\n: : invalid\n---\nPrompt"), "workflow_parse_error");
  });

  it("trims prompt body", () => {
    const result = parseWorkflow("---\nkey: val\n---\n\n  Prompt  \n\n");
    expect(result.prompt_template).toBe("Prompt");
  });
});
