import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceManager, sanitizeKey } from "../src/workspace.js";
import type { HooksConfig } from "../src/types.js";

const noHooks: HooksConfig = {
  after_create: null,
  before_run: null,
  after_run: null,
  before_remove: null,
  timeout_ms: 60000,
};

let testRoot: string;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-test-"));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe("sanitizeKey", () => {
  it("passes through valid characters", () => {
    expect(sanitizeKey("MT-123")).toBe("MT-123");
    expect(sanitizeKey("abc.def_ghi")).toBe("abc.def_ghi");
  });

  it("replaces invalid characters with underscore", () => {
    expect(sanitizeKey("ABC 123")).toBe("ABC_123");
    expect(sanitizeKey("a/b\\c")).toBe("a_b_c");
  });
});

describe("WorkspaceManager", () => {
  it("creates new workspace directory", () => {
    const mgr = new WorkspaceManager(testRoot);
    const ws = mgr.createForIssue("MT-1", noHooks);
    expect(ws.created_now).toBe(true);
    expect(ws.workspace_key).toBe("MT-1");
    expect(fs.existsSync(ws.path)).toBe(true);
  });

  it("reuses existing workspace", () => {
    const mgr = new WorkspaceManager(testRoot);
    mgr.createForIssue("MT-1", noHooks);
    const ws2 = mgr.createForIssue("MT-1", noHooks);
    expect(ws2.created_now).toBe(false);
  });

  it("runs after_create hook on new workspace", () => {
    const mgr = new WorkspaceManager(testRoot);
    const hooks: HooksConfig = {
      ...noHooks,
      after_create: "echo created > marker.txt",
    };
    const ws = mgr.createForIssue("MT-2", hooks);
    expect(fs.existsSync(path.join(ws.path, "marker.txt"))).toBe(true);
  });

  it("does not run after_create on existing workspace", () => {
    const mgr = new WorkspaceManager(testRoot);
    mgr.createForIssue("MT-3", noHooks);
    const hooks: HooksConfig = {
      ...noHooks,
      after_create: "echo created > marker.txt",
    };
    const ws = mgr.createForIssue("MT-3", hooks);
    expect(ws.created_now).toBe(false);
    expect(fs.existsSync(path.join(ws.path, "marker.txt"))).toBe(false);
  });

  it("removes workspace on after_create failure", () => {
    const mgr = new WorkspaceManager(testRoot);
    const hooks: HooksConfig = {
      ...noHooks,
      after_create: "exit 1",
    };
    expect(() => mgr.createForIssue("MT-4", hooks)).toThrow();
    expect(fs.existsSync(path.join(testRoot, "MT-4"))).toBe(false);
  });

  it("removes workspace with before_remove hook", () => {
    const mgr = new WorkspaceManager(testRoot);
    const ws = mgr.createForIssue("MT-5", noHooks);
    const hooks: HooksConfig = {
      ...noHooks,
      before_remove: "echo removing",
    };
    mgr.removeWorkspace("MT-5", hooks);
    expect(fs.existsSync(ws.path)).toBe(false);
  });

  it("rejects workspace path escaping root", () => {
    const mgr = new WorkspaceManager(testRoot);
    // sanitizeKey replaces / with _, so direct traversal via identifier is blocked
    // but let's test the validation method directly
    expect(() => mgr.validateWorkspaceCwd("/etc/passwd")).toThrow("outside root");
  });

  it("deterministic path per identifier", () => {
    const mgr = new WorkspaceManager(testRoot);
    expect(mgr.getWorkspacePath("MT-1")).toBe(mgr.getWorkspacePath("MT-1"));
    expect(mgr.getWorkspacePath("MT-1")).not.toBe(mgr.getWorkspacePath("MT-2"));
  });
});
