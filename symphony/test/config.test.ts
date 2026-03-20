import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseConfig, validateDispatchConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("applies defaults for empty config", () => {
    const cfg = parseConfig({});
    expect(cfg.polling.interval_ms).toBe(30000);
    expect(cfg.agent.max_concurrent_agents).toBe(10);
    expect(cfg.agent.max_turns).toBe(20);
    expect(cfg.agent.max_retry_backoff_ms).toBe(300000);
    expect(cfg.codex.command).toBe("codex app-server");
    expect(cfg.codex.turn_timeout_ms).toBe(3600000);
    expect(cfg.codex.read_timeout_ms).toBe(5000);
    expect(cfg.codex.stall_timeout_ms).toBe(300000);
    expect(cfg.hooks.timeout_ms).toBe(60000);
    expect(cfg.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(cfg.tracker.terminal_states).toContain("Done");
    expect(cfg.tracker.terminal_states).toContain("Cancelled");
  });

  it("parses tracker config", () => {
    const cfg = parseConfig({
      tracker: {
        kind: "linear",
        project_slug: "my-proj",
        active_states: "Todo, In Progress, Blocked",
      },
    });
    expect(cfg.tracker.kind).toBe("linear");
    expect(cfg.tracker.project_slug).toBe("my-proj");
    expect(cfg.tracker.active_states).toEqual(["Todo", "In Progress", "Blocked"]);
  });

  it("resolves $VAR for api_key", () => {
    const orig = process.env.TEST_API_KEY;
    process.env.TEST_API_KEY = "secret123";
    try {
      const cfg = parseConfig({ tracker: { api_key: "$TEST_API_KEY" } });
      expect(cfg.tracker.api_key).toBe("secret123");
    } finally {
      if (orig === undefined) delete process.env.TEST_API_KEY;
      else process.env.TEST_API_KEY = orig;
    }
  });

  it("coerces string integers", () => {
    const cfg = parseConfig({
      polling: { interval_ms: "5000" },
      agent: { max_concurrent_agents: "3" },
    });
    expect(cfg.polling.interval_ms).toBe(5000);
    expect(cfg.agent.max_concurrent_agents).toBe(3);
  });

  it("parses per-state concurrency with normalization", () => {
    const cfg = parseConfig({
      agent: {
        max_concurrent_agents_by_state: {
          "In Progress": 2,
          "  Todo  ": "3",
          Invalid: -1,
          Bad: "not_a_number",
        },
      },
    });
    expect(cfg.agent.max_concurrent_agents_by_state.get("in progress")).toBe(2);
    expect(cfg.agent.max_concurrent_agents_by_state.get("todo")).toBe(3);
    expect(cfg.agent.max_concurrent_agents_by_state.has("invalid")).toBe(false);
    expect(cfg.agent.max_concurrent_agents_by_state.has("bad")).toBe(false);
  });

  it("falls back to default on non-positive hook timeout", () => {
    const cfg = parseConfig({ hooks: { timeout_ms: -1 } });
    expect(cfg.hooks.timeout_ms).toBe(60000);
  });

  it("heartbeat disabled by default (no command)", () => {
    const cfg = parseConfig({});
    expect(cfg.heartbeat.enabled).toBe(false);
    expect(cfg.heartbeat.command).toBe("");
    expect(cfg.heartbeat.interval_ms).toBe(60000);
    expect(cfg.heartbeat.prompt_template).toBe("");
  });

  it("heartbeat auto-enables when command is set", () => {
    const cfg = parseConfig({ heartbeat: { command: "claude -p" } });
    expect(cfg.heartbeat.enabled).toBe(true);
    expect(cfg.heartbeat.command).toBe("claude -p");
  });

  it("heartbeat can be explicitly disabled even with command", () => {
    const cfg = parseConfig({ heartbeat: { command: "claude -p", enabled: false } });
    expect(cfg.heartbeat.enabled).toBe(false);
  });

  it("heartbeat parses custom interval and template", () => {
    const cfg = parseConfig({
      heartbeat: {
        command: "my-cli --pipe",
        interval_ms: 120000,
        prompt_template: "Custom {{ issue.identifier }}",
      },
    });
    expect(cfg.heartbeat.interval_ms).toBe(120000);
    expect(cfg.heartbeat.prompt_template).toBe("Custom {{ issue.identifier }}");
  });
});

describe("validateDispatchConfig", () => {
  it("passes with valid config", () => {
    const cfg = parseConfig({
      tracker: { kind: "linear", api_key: "test-key", project_slug: "proj" },
    });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails without tracker.kind", () => {
    const cfg = parseConfig({});
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("tracker.kind"))).toBe(true);
  });

  it("fails with unsupported tracker kind", () => {
    const cfg = parseConfig({ tracker: { kind: "jira" } });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("unsupported"))).toBe(true);
  });

  it("fails without api_key", () => {
    const cfg = parseConfig({ tracker: { kind: "linear", project_slug: "p" } });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("api_key"))).toBe(true);
  });

  it("fails without project_slug for linear", () => {
    const cfg = parseConfig({ tracker: { kind: "linear", api_key: "key" } });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("project_slug"))).toBe(true);
  });

  it("fails when heartbeat enabled without command", () => {
    const cfg = parseConfig({
      tracker: { kind: "linear", api_key: "key", project_slug: "p" },
      heartbeat: { enabled: true },
    });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("heartbeat.command"))).toBe(true);
  });

  it("passes when heartbeat enabled with command", () => {
    const cfg = parseConfig({
      tracker: { kind: "linear", api_key: "key", project_slug: "p" },
      heartbeat: { command: "claude -p" },
    });
    const result = validateDispatchConfig(cfg);
    expect(result.ok).toBe(true);
  });
});
