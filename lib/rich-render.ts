/**
 * Pure data-transform functions for rich-mode rendering.
 * Extracted from rich-view.tsx so they can be unit-tested.
 */

// ---- Stream-JSON event types (subset of Claude Code output) ----

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ContentBlockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | ContentBlockToolResult;

// ---- Render items (render-time grouping) ----

export type RenderItem =
  | { kind: "text"; block: ContentBlockText }
  | { kind: "tool_pair"; toolUse: ContentBlockToolUse; toolResult: ContentBlockToolResult | null }
  | { kind: "tool_group"; name: string; pairs: Array<{ toolUse: ContentBlockToolUse; toolResult: ContentBlockToolResult | null }> }
  | { kind: "subagent"; toolUse: ContentBlockToolUse; toolResult: ContentBlockToolResult | null }
  | { kind: "question"; toolUse: ContentBlockToolUse; toolResult: ContentBlockToolResult | null };

/**
 * Transform a list of content blocks into grouped render items.
 * Consecutive tool_use blocks with the same name are merged into tool_groups.
 * AskUserQuestion is rendered as a question card. Task as a subagent card.
 * tool_result blocks are skipped (paired via resultMap).
 */
export function buildRenderItems(
  blocks: ContentBlock[],
  resultMap: Map<string, ContentBlockToolResult>,
): RenderItem[] {
  const items: RenderItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "text") {
      items.push({ kind: "text", block });
      i++;
      continue;
    }

    if (block.type === "tool_result") {
      // Skip — rendered inline via resultMap
      i++;
      continue;
    }

    // tool_use
    if (block.type === "tool_use") {
      // AskUserQuestion — render as interactive question card
      if (block.name === "AskUserQuestion") {
        items.push({
          kind: "question",
          toolUse: block,
          toolResult: resultMap.get(block.id) ?? null,
        });
        i++;
        continue;
      }

      // Subagent
      if (block.name === "Task") {
        items.push({
          kind: "subagent",
          toolUse: block,
          toolResult: resultMap.get(block.id) ?? null,
        });
        i++;
        continue;
      }

      // Collect consecutive tool_use with same name
      const run: ContentBlockToolUse[] = [block];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === "tool_use" && (blocks[j] as ContentBlockToolUse).name === block.name) {
        run.push(blocks[j] as ContentBlockToolUse);
        j++;
      }

      if (run.length >= 2) {
        items.push({
          kind: "tool_group",
          name: block.name,
          pairs: run.map((tu) => ({
            toolUse: tu,
            toolResult: resultMap.get(tu.id) ?? null,
          })),
        });
      } else {
        items.push({
          kind: "tool_pair",
          toolUse: block,
          toolResult: resultMap.get(block.id) ?? null,
        });
      }
      i = j;
      continue;
    }

    i++;
  }
  return items;
}

// ---- Helpers ----

export function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const truncated = s.slice(0, max);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

export function getToolSummary(name: string, input: Record<string, any>): string {
  if (name === "Task" && input.description) {
    return truncateAtWord(input.description as string, 80);
  }
  if (name === "Read" && input.file_path) return input.file_path;
  if (name === "Edit" && input.file_path) return input.file_path;
  if (name === "Write" && input.file_path) return input.file_path;
  if (name === "Bash" && input.command) {
    return truncateAtWord(input.command as string, 60);
  }
  if (name === "Glob" && input.pattern) return input.pattern;
  if (name === "Grep" && input.pattern) return input.pattern;
  if (name === "WebSearch" && input.query) return input.query;
  if (name === "WebFetch" && input.url) return input.url;
  return "";
}

export function formatToolInput(name: string, input: Record<string, any>): string {
  if (name === "Edit") {
    const parts: string[] = [];
    if (input.file_path) parts.push(`file: ${input.file_path}`);
    if (input.old_string != null) {
      parts.push(`--- old\n${input.old_string}`);
      parts.push(`+++ new\n${input.new_string || ""}`);
    }
    return parts.join("\n\n");
  }

  if (name === "Bash") {
    return input.command || JSON.stringify(input, null, 2);
  }

  if (name === "Write") {
    const parts: string[] = [];
    if (input.file_path) parts.push(`file: ${input.file_path}`);
    if (input.content) {
      const content = input.content as string;
      const lines = content.split("\n");
      if (lines.length > 30) {
        parts.push(lines.slice(0, 25).join("\n") + `\n… (${lines.length} lines total)`);
      } else {
        parts.push(content);
      }
    }
    return parts.join("\n\n");
  }

  if (name === "Task") {
    const parts: string[] = [];
    if (input.subagent_type) parts.push(`type: ${input.subagent_type}`);
    if (input.prompt) {
      const prompt = input.prompt as string;
      const lines = prompt.split("\n");
      if (lines.length > 20) {
        parts.push(lines.slice(0, 15).join("\n") + `\n… (${lines.length} lines total)`);
      } else {
        parts.push(prompt);
      }
    }
    return parts.join("\n\n");
  }

  return JSON.stringify(input, null, 2);
}

