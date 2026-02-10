import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock child_process before importing sessions
vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => "/usr/local/bin/tmux\n"),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: Buffer.from("") })),
  execSync: vi.fn(() => ""),
}));

import { spawnSync, execSync } from "child_process";

let tempDir: string;
let origCwd: () => string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sessions-test-"));
  origCwd = process.cwd;
  process.cwd = () => tempDir;

  vi.mocked(spawnSync).mockReset();
  vi.mocked(execSync).mockReset();
  // Default: has-session returns 1 (not found), everything else succeeds
  vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
    if (args && (args as string[]).includes("has-session")) {
      return { status: 1, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
    }
    return { status: 0, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
  });
});

afterEach(() => {
  process.cwd = origCwd;
  const g = globalThis as any;
  delete g.__sessions;
  delete g.__sessionsVersion;
  rmSync(tempDir, { recursive: true, force: true });
});

import { getSessionManager } from "./sessions";

function mgr() {
  return getSessionManager();
}

describe("SessionManager", () => {
  describe("list", () => {
    it("returns empty array initially", () => {
      expect(mgr().list("local")).toEqual([]);
    });

    it("auto-cleans dead sessions from DB", async () => {
      // Create a session (tmux mock succeeds for new-session)
      await mgr().create("", "bash");
      // has-session returns 1 (dead) by default, so list should clean it up
      expect(mgr().list("local")).toEqual([]);
    });

    it("returns alive sessions with alive=true", async () => {
      const created = await mgr().create("desc", "bash");
      // Make has-session return 0 (alive) for this session
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      const sessions = mgr().list("local");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe(created.name);
      expect(sessions[0].alive).toBe(true);
    });
  });

  describe("create", () => {
    it("creates a tmux session with server-generated slug", async () => {
      const session = await mgr().create("desc", "bash");

      expect(session.name).toMatch(/^[a-z]+-[a-z]+/);
      expect(session.description).toBe("desc");
      expect(session.command).toBe("bash");
      expect(session.alive).toBe(true);

      const calls = vi.mocked(spawnSync).mock.calls;
      const newSessionCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      expect(newSessionCall).toBeDefined();
    });

    it("configures tmux options", async () => {
      await mgr().create("", "bash");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setOptionCalls = calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("set-option"),
      );
      expect(setOptionCalls.length).toBeGreaterThanOrEqual(4);
    });

    it("generates CLAUDE_SESSION_ID for claude commands", async () => {
      await mgr().create("", "claude");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeDefined();
    });

    it("includes --session-id in the launched command for claude", async () => {
      await mgr().create("", "claude --verbose");

      const calls = vi.mocked(spawnSync).mock.calls;
      const sendKeysCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      const sentCommand = (sendKeysCall![1] as string[])[3];
      expect(sentCommand).toContain("--session-id");
      expect(sentCommand).toContain("--verbose");
    });

    it("does not generate session ID for non-claude commands", async () => {
      await mgr().create("", "bash");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeUndefined();
    });

    it("generates valid adjective-noun slugs", async () => {
      const s = await mgr().create("", "bash");
      expect(s.name).toMatch(/^[a-z]+-[a-z]+/);
    });

    it("defaults command to claude with theme settings", async () => {
      const s = await mgr().create("");
      expect(s.command).toContain("claude");
      expect(s.command).toContain("--settings");
      expect(s.command).toContain("dark-ansi");
    });

    it("uses dark-ansi theme even when mode is light", async () => {
      const m = mgr();
      m.setConfig("mode", "light", "local");
      const s = await m.create("");
      expect(s.command).toContain("dark-ansi");
    });
  });

  describe("delete", () => {
    it("removes session from DB", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      // Make session alive so list returns it
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      expect(m.list("local")).toHaveLength(1);

      await m.delete(created.name, "local");
      expect(m.list("local")).toHaveLength(0);
    });

    it("kills tmux session if it exists", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any; // session exists
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      await m.delete(created.name, "local");

      const killCalls = vi.mocked(spawnSync).mock.calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("kill-session"),
      );
      expect(killCalls).toHaveLength(1);
    });

    it("skips tmux kill if session not running", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      // Reset to default: has-session returns 1 (not running)
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 1, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
      });

      await m.delete(created.name, "local");

      const killCalls = vi.mocked(spawnSync).mock.calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("kill-session"),
      );
      expect(killCalls).toHaveLength(0);
    });
  });

  describe("config", () => {
    it("returns null for non-existent key", () => {
      expect(mgr().getConfig("missing", "local")).toBeNull();
    });

    it("sets and gets a config value", () => {
      const m = mgr();
      m.setConfig("theme", "dark", "local");
      expect(m.getConfig("theme", "local")).toBe("dark");
    });

    it("overwrites existing config value", () => {
      const m = mgr();
      m.setConfig("theme", "dark", "local");
      m.setConfig("theme", "light", "local");
      expect(m.getConfig("theme", "local")).toBe("light");
    });

    it("returns all config as an object", () => {
      const m = mgr();
      m.setConfig("theme", "dark", "local");
      m.setConfig("font", "mono", "local");
      expect(m.getAllConfig("local")).toEqual({ theme: "dark", font: "mono" });
    });

    it("returns empty object when no config exists", () => {
      expect(mgr().getAllConfig("local")).toEqual({});
    });
  });

  describe("snapshot", () => {
    it("returns placeholder when tmux session not running", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      // has-session returns 1 by default
      expect(await m.snapshot(created.name, "local")).toBe("[session not running]");
    });

    it("returns tmux capture-pane output for running session", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        if (args && (args as string[]).includes("capture-pane")) {
          return { status: 0, stdout: "hello world\n" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      expect(await m.snapshot(created.name, "local")).toBe("hello world\n");
    });

    it("returns [empty] when capture-pane returns no output", async () => {
      const m = mgr();
      const created = await m.create("", "bash");
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        if (args && (args as string[]).includes("capture-pane")) {
          return { status: 0, stdout: "" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      expect(await m.snapshot(created.name, "local")).toBe("[empty]");
    });
  });

  describe("getForkHooks", () => {
    it("returns default hook when no config set", () => {
      const hooks = mgr().getForkHooks("local");
      expect(hooks).toHaveProperty("claude");
      expect(hooks.claude).toContain("fork-claude.sh");
    });

    it("returns parsed hooks from config", () => {
      const m = mgr();
      m.setConfig("forkHooks", JSON.stringify({ python: "/usr/bin/hook.sh" }), "local");
      expect(m.getForkHooks("local")).toEqual({ python: "/usr/bin/hook.sh" });
    });

    it("returns empty object for invalid JSON in config", () => {
      const m = mgr();
      m.setConfig("forkHooks", "not json", "local");
      expect(m.getForkHooks("local")).toEqual({});
    });
  });

  describe("createJob", () => {
    it("creates a job session with server-generated slug", async () => {
      const session = await mgr().createJob("do something", 10);

      expect(session.name).toMatch(/^[a-z]+-[a-z]+/);
      expect(session.job_prompt).toBe("do something");
      expect(session.job_max_iterations).toBe(10);
      expect(session.command).toContain("claude --dangerously-skip-permissions");
      expect(session.command).toContain("--settings");
      expect(session.alive).toBe(true);
    });

    it("delegates to executor (tmux new-session via TmuxRunner)", async () => {
      await mgr().createJob("task prompt", 5);

      const calls = vi.mocked(spawnSync).mock.calls;
      const newSessionCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      expect(newSessionCall).toBeDefined();
    });

    it("does not create ralph-loop.local.md", async () => {
      await mgr().createJob("prompt", 3);

      // Check neither the temp dir .claude nor any ralph-loop file was created
      const claudeDir = join(tempDir, ".claude");
      expect(existsSync(join(claudeDir, "ralph-loop.local.md"))).toBe(false);
    });

    it("launcher script contains for-loop pattern", async () => {
      await mgr().createJob("test prompt", 5);

      // The launcher script path is passed to tmux send-keys as "bash /tmp/claude-job-<uuid>.sh"
      const calls = vi.mocked(spawnSync).mock.calls;
      const sendKeysCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      const sentCommand = (sendKeysCall![1] as string[])[3];
      const launcherPath = sentCommand.replace("bash ", "");

      // Read the actual launcher script from disk
      const script = readFileSync(launcherPath, "utf-8");
      expect(script).toContain("for (( i=1; i<=MAX_ITER; i++ ))");
      expect(script).toContain("--resume");
      expect(script).toContain("<promise>DONE</promise>");
      expect(script).toContain("trap");
    });

    it("stores CLAUDE_SESSION_ID in tmux env", async () => {
      await mgr().createJob("prompt", 3);

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeDefined();
    });
  });

  describe("fork", () => {
    // Helper: create a source session in the DB so fork can find it
    async function createSource(m: ReturnType<typeof mgr>, command = "claude") {
      const source = await m.create("", command);
      vi.mocked(spawnSync).mockReset();
      // Reset to default: has-session returns 1 (not found) for new session
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 1, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
        }
        // display-message for getPaneCwd — return empty (no cwd)
        if (args && (args as string[]).includes("display-message")) {
          return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from(""), pid: 0, output: [], signal: null } as any;
      });
      return source.name;
    }

    it("uses source command from DB", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      // Disable hooks so command passes through directly
      m.setConfig("forkHooks", "{}", "local");

      const session = await m.fork(sourceName, "local");

      expect(session.command).toBe("bash");
      // send-keys should include the source command
      const sendKeysCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      expect((sendKeysCall![1] as string[])[3]).toBe("bash");
    });

    it("rejects fork when source not in DB", async () => {
      const m = mgr();
      m.setConfig("forkHooks", "{}", "local");

      await expect(m.fork("nonexistent", "local")).rejects.toThrow("Not found");
    });

    it("returns correct session object with server-generated slug", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      const session = await m.fork(sourceName, "local");

      expect(session.name).toMatch(/^[a-z]+-[a-z]+/);
      expect(session.name).not.toBe(sourceName);
      expect(session.description).toBe(`forked from ${sourceName}`);
      expect(session.alive).toBe(true);
      expect(session.created_at).toBeDefined();
    });

    it("creates tmux session with standard options", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      await m.fork(sourceName, "local");

      const calls = vi.mocked(spawnSync).mock.calls;
      const newSessionCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      expect(newSessionCall).toBeDefined();
      const setOptionCalls = calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("set-option"),
      );
      expect(setOptionCalls.length).toBeGreaterThanOrEqual(4);
    });

    it("includes -c <cwd> when source has a working directory", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      // getPaneCwd calls tmuxExists(source) then display-message
      // has-session must return 0 for source (so getPaneCwd proceeds)
      // but 1 for new slug (so fork doesn't think it already exists)
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          const target = (args as string[])[(args as string[]).indexOf("-t") + 1];
          return { status: target === sourceName ? 0 : 1 } as any;
        }
        if (args && (args as string[]).includes("display-message")) {
          return { status: 0, stdout: "/home/user/project\n" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      await m.fork(sourceName, "local");

      const newSessionCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      const args = newSessionCall![1] as string[];
      expect(args).toContain("-c");
      expect(args).toContain("/home/user/project");
    });

    it("does not include -c when source has no CWD", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      await m.fork(sourceName, "local");

      const newSessionCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      const args = newSessionCall![1] as string[];
      expect(args).not.toContain("-c");
    });

    it("sends claude command as-is in fork (no inline --session-id)", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "claude");
      m.setConfig("forkHooks", "{}", "local");

      await m.fork(sourceName, "local");

      const calls = vi.mocked(spawnSync).mock.calls;
      const sendKeysCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      // fork sends the stored command (with --settings), not "claude --session-id <uuid>"
      const sentCommand = (sendKeysCall![1] as string[])[3];
      expect(sentCommand).toContain("claude");
      expect(sentCommand).not.toContain("--session-id");
    });

    it("does not generate session ID for non-claude forked commands", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      await m.fork(sourceName, "local");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeUndefined();
    });

    it("throws when tmux new-session fails", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 1 } as any;
        }
        if (args && (args as string[]).includes("new-session")) {
          return { status: 1, stderr: Buffer.from("tmux error") } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      await expect(m.fork(sourceName, "local")).rejects.toThrow("Failed to create tmux session");
    });

    it("executes fork hook and uses its output as command", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "claude");

      // Create a real hook file so existsSync finds it
      const hookDir = join(tempDir, "hooks");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(hookDir, "fork-claude.sh"), "#!/bin/bash\necho 'claude --resume abc'");

      // Mock execSync to return the hook output
      vi.mocked(execSync).mockReturnValue("claude --resume abc\n");

      const session = await m.fork(sourceName, "local");

      // The hook output should be the fork command
      expect(session.command).toBe("claude --resume abc");
      expect(vi.mocked(execSync)).toHaveBeenCalled();
    });

    it("falls back to source command when hook fails", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "claude");

      // Create hook file
      const hookDir = join(tempDir, "hooks");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(hookDir, "fork-claude.sh"), "#!/bin/bash\nexit 1");

      // Mock execSync to throw (hook failure)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("hook failed");
      });

      const session = await m.fork(sourceName, "local");

      // Should fall back to the source command (which includes --settings from create)
      expect(session.command).toContain("claude");
      expect(session.command).toContain("--settings");
    });

    it("does not run hook when hook file does not exist", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "claude");
      // No hook file created in tempDir — existsSync returns false

      await m.fork(sourceName, "local");

      // execSync should NOT have been called for hook
      expect(vi.mocked(execSync)).not.toHaveBeenCalled();
    });

    it("persists forked session in DB", async () => {
      const m = mgr();
      const sourceName = await createSource(m, "bash");
      m.setConfig("forkHooks", "{}", "local");

      const forked = await m.fork(sourceName, "local");

      // Make has-session return 0 so list shows sessions
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      const sessions = m.list("local");
      const found = sessions.find((s: any) => s.name === forked.name);
      expect(found).toBeDefined();
      expect(found!.description).toBe(`forked from ${sourceName}`);
    });
  });

  describe("executor keys", () => {
    it("creates a key and returns token with chk_ prefix", () => {
      const m = mgr();
      const result = m.createExecutorKey("user1", "My Key", null);
      expect(result.id).toBeDefined();
      expect(result.token).toMatch(/^chk_[0-9a-f]{64}$/);
      expect(result.key_prefix).toHaveLength(8);
    });

    it("validates a valid token", () => {
      const m = mgr();
      const { token } = m.createExecutorKey("user1", "test", null);
      const result = m.validateExecutorKey(token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("user1");
      expect(result!.keyId).toBeDefined();
    });

    it("rejects an invalid token", () => {
      const m = mgr();
      m.createExecutorKey("user1", "test", null);
      expect(m.validateExecutorKey("chk_0000000000000000000000000000000000000000000000000000000000000000")).toBeNull();
    });

    it("rejects a token without chk_ prefix", () => {
      expect(mgr().validateExecutorKey("not-a-valid-token")).toBeNull();
    });

    it("rejects a revoked key", () => {
      const m = mgr();
      const { id, token } = m.createExecutorKey("user1", "test", null);
      m.revokeExecutorKey("user1", id);
      expect(m.validateExecutorKey(token)).toBeNull();
    });

    it("rejects an expired key", () => {
      const m = mgr();
      // Create key that expired 1 hour ago
      const expiredAt = Math.floor(Date.now() / 1000) - 3600;
      const { token } = m.createExecutorKey("user1", "test", expiredAt);
      expect(m.validateExecutorKey(token)).toBeNull();
    });

    it("accepts a key that has not expired yet", () => {
      const m = mgr();
      const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      const { token } = m.createExecutorKey("user1", "test", expiresAt);
      expect(m.validateExecutorKey(token)).not.toBeNull();
    });

    it("updates last_used on successful validation", () => {
      const m = mgr();
      const { token } = m.createExecutorKey("user1", "test", null);
      const keysBefore = m.listExecutorKeys("user1");
      expect(keysBefore[0].last_used).toBeNull();

      m.validateExecutorKey(token);
      const keysAfter = m.listExecutorKeys("user1");
      expect(keysAfter[0].last_used).not.toBeNull();
    });

    it("lists keys for a user", () => {
      const m = mgr();
      m.createExecutorKey("user1", "Key A", null);
      m.createExecutorKey("user1", "Key B", null);
      m.createExecutorKey("user2", "Other", null);

      const keys = m.listExecutorKeys("user1");
      expect(keys).toHaveLength(2);
      expect(keys.map((k) => k.name).sort()).toEqual(["Key A", "Key B"]);
    });

    it("does not list other users keys", () => {
      const m = mgr();
      m.createExecutorKey("user1", "mine", null);
      expect(m.listExecutorKeys("user2")).toHaveLength(0);
    });

    it("revokes a key", () => {
      const m = mgr();
      const { id } = m.createExecutorKey("user1", "test", null);
      expect(m.revokeExecutorKey("user1", id)).toBe(true);

      const keys = m.listExecutorKeys("user1");
      expect(keys[0].revoked).toBe(true);
    });

    it("cannot revoke another users key", () => {
      const m = mgr();
      const { id } = m.createExecutorKey("user1", "test", null);
      expect(m.revokeExecutorKey("user2", id)).toBe(false);
    });

    it("handles prefix collision gracefully", () => {
      const m = mgr();
      // Create many keys — prefix collisions are extremely unlikely with 8 hex chars
      // but the code handles them by iterating rows
      const tokens: string[] = [];
      for (let i = 0; i < 10; i++) {
        tokens.push(m.createExecutorKey("user1", `key${i}`, null).token);
      }
      // All should validate correctly
      for (const token of tokens) {
        expect(m.validateExecutorKey(token)).not.toBeNull();
      }
    });
  });
});
