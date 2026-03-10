// WORKFLOW.md loader — spec §5.1-5.2

import * as fs from "node:fs";
import * as yaml from "js-yaml";
import { SymphonyError, type WorkflowDefinition } from "./types.js";

export function loadWorkflow(path: string): WorkflowDefinition {
  let content: string;
  try {
    content = fs.readFileSync(path, "utf-8");
  } catch {
    throw new SymphonyError("missing_workflow_file", `Cannot read workflow file: ${path}`);
  }

  return parseWorkflow(content);
}

export function parseWorkflow(content: string): WorkflowDefinition {
  const lines = content.split("\n");

  // Check for YAML front matter
  if (lines[0]?.trim() === "---") {
    const endIndex = lines.indexOf("---", 1);
    if (endIndex === -1) {
      throw new SymphonyError("workflow_parse_error", "Unterminated YAML front matter (missing closing ---)");
    }

    const yamlContent = lines.slice(1, endIndex).join("\n");
    const promptBody = lines.slice(endIndex + 1).join("\n").trim();

    let config: unknown;
    try {
      config = yaml.load(yamlContent);
    } catch (e) {
      throw new SymphonyError(
        "workflow_parse_error",
        `Invalid YAML front matter: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Empty YAML (e.g. just whitespace between ---) yields null
    if (config === null || config === undefined) {
      return { config: {}, prompt_template: promptBody };
    }

    if (typeof config !== "object" || Array.isArray(config)) {
      throw new SymphonyError("workflow_front_matter_not_a_map", "YAML front matter must be a map/object");
    }

    return {
      config: config as Record<string, unknown>,
      prompt_template: promptBody,
    };
  }

  // No front matter — entire file is prompt body
  return {
    config: {},
    prompt_template: content.trim(),
  };
}
