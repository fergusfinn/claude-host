import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
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
      expect(mgr().list()).toEqual([]);
    });

    it("auto-cleans dead sessions from DB", () => {
      // Create a session (tmux mock succeeds for new-session)
      mgr().create("will-die", "", "bash");
      // has-session returns 1 (dead) by default, so list should clean it up
      expect(mgr().list()).toEqual([]);
    });

    it("returns alive sessions with alive=true", () => {
      mgr().create("alive-sess", "desc", "bash");
      // Make has-session return 0 (alive) for this session
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      const sessions = mgr().list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe("alive-sess");
      expect(sessions[0].alive).toBe(true);
    });
  });

  describe("create", () => {
    it("creates a tmux session", () => {
      const session = mgr().create("test-term", "desc", "bash");

      expect(session.name).toBe("test-term");
      expect(session.description).toBe("desc");
      expect(session.command).toBe("bash");
      expect(session.alive).toBe(true);

      const calls = vi.mocked(spawnSync).mock.calls;
      const newSessionCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      expect(newSessionCall).toBeDefined();
    });

    it("configures tmux options", () => {
      mgr().create("opts-test", "", "bash");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setOptionCalls = calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("set-option"),
      );
      expect(setOptionCalls.length).toBeGreaterThanOrEqual(4);
    });

    it("generates CLAUDE_SESSION_ID for claude commands", () => {
      mgr().create("claude-sess", "", "claude");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeDefined();
    });

    it("includes --session-id in the launched command for claude", () => {
      mgr().create("claude-args", "", "claude --verbose");

      const calls = vi.mocked(spawnSync).mock.calls;
      const sendKeysCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      const sentCommand = (sendKeysCall![1] as string[])[3];
      expect(sentCommand).toContain("--session-id");
      expect(sentCommand).toContain("--verbose");
    });

    it("does not generate session ID for non-claude commands", () => {
      mgr().create("bash-sess", "", "bash");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeUndefined();
    });

    it("rejects invalid names", () => {
      expect(() => mgr().create("bad name!", "", "bash")).toThrow("Name must be alphanumeric");
      expect(() => mgr().create("bad/path", "", "bash")).toThrow("Name must be alphanumeric");
      expect(() => mgr().create("", "", "bash")).toThrow("Name must be alphanumeric");
    });

    it("accepts valid names with hyphens and underscores", () => {
      const s = mgr().create("my-session_1", "", "bash");
      expect(s.name).toBe("my-session_1");
    });

    it("throws when tmux session already exists", () => {
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any; // session exists
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      expect(() => mgr().create("existing", "", "bash")).toThrow(
        'Session "existing" already exists',
      );
    });

    it("defaults command to claude", () => {
      const s = mgr().create("default-cmd", "");
      expect(s.command).toBe("claude");
    });
  });

  describe("delete", () => {
    it("removes session from DB", () => {
      const m = mgr();
      m.create("to-delete", "", "bash");
      // Make session alive so list returns it
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      expect(m.list()).toHaveLength(1);

      m.delete("to-delete");
      expect(m.list()).toHaveLength(0);
    });

    it("kills tmux session if it exists", () => {
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any; // session exists
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      mgr().delete("some-sess");

      const killCalls = vi.mocked(spawnSync).mock.calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("kill-session"),
      );
      expect(killCalls).toHaveLength(1);
    });

    it("skips tmux kill if session not running", () => {
      // has-session returns 1 by default (not running)
      mgr().delete("dead-sess");

      const killCalls = vi.mocked(spawnSync).mock.calls.filter(
        (c) => c[1] && (c[1] as string[]).includes("kill-session"),
      );
      expect(killCalls).toHaveLength(0);
    });
  });

  describe("config", () => {
    it("returns null for non-existent key", () => {
      expect(mgr().getConfig("missing")).toBeNull();
    });

    it("sets and gets a config value", () => {
      const m = mgr();
      m.setConfig("theme", "dark");
      expect(m.getConfig("theme")).toBe("dark");
    });

    it("overwrites existing config value", () => {
      const m = mgr();
      m.setConfig("theme", "dark");
      m.setConfig("theme", "light");
      expect(m.getConfig("theme")).toBe("light");
    });

    it("returns all config as an object", () => {
      const m = mgr();
      m.setConfig("theme", "dark");
      m.setConfig("font", "mono");
      expect(m.getAllConfig()).toEqual({ theme: "dark", font: "mono" });
    });

    it("returns empty object when no config exists", () => {
      expect(mgr().getAllConfig()).toEqual({});
    });
  });

  describe("snapshot", () => {
    it("returns placeholder when tmux session not running", () => {
      // has-session returns 1 by default
      expect(mgr().snapshot("dead")).toBe("[session not running]");
    });

    it("returns tmux capture-pane output for running session", () => {
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        if (args && (args as string[]).includes("capture-pane")) {
          return { status: 0, stdout: "hello world\n" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      expect(mgr().snapshot("running")).toBe("hello world\n");
    });

    it("returns [empty] when capture-pane returns no output", () => {
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        if (args && (args as string[]).includes("capture-pane")) {
          return { status: 0, stdout: "" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      expect(mgr().snapshot("empty")).toBe("[empty]");
    });
  });

  describe("getForkHooks", () => {
    it("returns default hook when no config set", () => {
      const hooks = mgr().getForkHooks();
      expect(hooks).toHaveProperty("claude");
      expect(hooks.claude).toContain("fork-claude.sh");
    });

    it("returns parsed hooks from config", () => {
      const m = mgr();
      m.setConfig("forkHooks", JSON.stringify({ python: "/usr/bin/hook.sh" }));
      expect(m.getForkHooks()).toEqual({ python: "/usr/bin/hook.sh" });
    });

    it("returns empty object for invalid JSON in config", () => {
      const m = mgr();
      m.setConfig("forkHooks", "not json");
      expect(m.getForkHooks()).toEqual({});
    });
  });

  describe("fork", () => {
    // Helper: create a source session in the DB so fork can find it
    function createSource(m: ReturnType<typeof mgr>, name = "source", command = "claude") {
      m.create(name, "", command);
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
    }

    it("rejects invalid names", () => {
      const m = mgr();
      createSource(m);
      expect(() => m.fork("source", "bad name!")).toThrow("Name must be alphanumeric");
      expect(() => m.fork("source", "bad/path")).toThrow("Name must be alphanumeric");
    });

    it("throws when target session already exists in tmux", () => {
      const m = mgr();
      createSource(m);
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any; // exists
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });
      expect(() => m.fork("source", "existing")).toThrow('Session "existing" already exists');
    });

    it("uses source command from DB", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      // Disable hooks so command passes through directly
      m.setConfig("forkHooks", "{}");

      const session = m.fork("source", "forked");

      expect(session.command).toBe("bash");
      // send-keys should include the source command
      const sendKeysCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      expect((sendKeysCall![1] as string[])[3]).toBe("bash");
    });

    it("defaults to claude when source not in DB", () => {
      const m = mgr();
      // Don't create source — fork should default to "claude"
      // Disable hooks
      m.setConfig("forkHooks", "{}");

      const session = m.fork("nonexistent", "forked");
      expect(session.command).toBe("claude");
    });

    it("returns correct session object", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      const session = m.fork("source", "new-fork");

      expect(session.name).toBe("new-fork");
      expect(session.description).toBe("forked from source");
      expect(session.alive).toBe(true);
      expect(session.created_at).toBeDefined();
    });

    it("creates tmux session with standard options", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      m.fork("source", "forked");

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

    it("includes -c <cwd> when source has a working directory", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      // getPaneCwd calls tmuxExists(source) then display-message
      // has-session must return 0 for "source" (so getPaneCwd proceeds)
      // but 1 for "forked" (so fork doesn't think it already exists)
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          const target = (args as string[])[(args as string[]).indexOf("-t") + 1];
          return { status: target === "source" ? 0 : 1 } as any;
        }
        if (args && (args as string[]).includes("display-message")) {
          return { status: 0, stdout: "/home/user/project\n" } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      m.fork("source", "forked");

      const newSessionCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      const args = newSessionCall![1] as string[];
      expect(args).toContain("-c");
      expect(args).toContain("/home/user/project");
    });

    it("does not include -c when source has no CWD", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      m.fork("source", "forked");

      const newSessionCall = vi.mocked(spawnSync).mock.calls.find(
        (c) => c[1] && (c[1] as string[]).includes("new-session"),
      );
      const args = newSessionCall![1] as string[];
      expect(args).not.toContain("-c");
    });

    it("sends claude command as-is in fork (no inline --session-id)", () => {
      // Unlike create(), fork() does NOT append --session-id to the command.
      // Instead it calls discoverNewSessionId() to poll for the session ID.
      const m = mgr();
      createSource(m, "source", "claude");
      m.setConfig("forkHooks", "{}");

      m.fork("source", "forked");

      const calls = vi.mocked(spawnSync).mock.calls;
      const sendKeysCall = calls.find(
        (c) => c[1] && (c[1] as string[]).includes("send-keys"),
      );
      expect(sendKeysCall).toBeDefined();
      // fork sends just "claude", not "claude --session-id <uuid>"
      expect((sendKeysCall![1] as string[])[3]).toBe("claude");
    });

    it("does not generate session ID for non-claude forked commands", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      m.fork("source", "forked");

      const calls = vi.mocked(spawnSync).mock.calls;
      const setEnvCall = calls.find(
        (c) =>
          c[1] &&
          (c[1] as string[]).includes("set-environment") &&
          (c[1] as string[]).includes("CLAUDE_SESSION_ID"),
      );
      expect(setEnvCall).toBeUndefined();
    });

    it("throws when tmux new-session fails", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 1 } as any;
        }
        if (args && (args as string[]).includes("new-session")) {
          return { status: 1, stderr: Buffer.from("tmux error") } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      expect(() => m.fork("source", "forked")).toThrow("Failed to create tmux session");
    });

    it("executes fork hook and uses its output as command", () => {
      const m = mgr();
      createSource(m, "source", "claude");

      // Create a real hook file so existsSync finds it
      const hookDir = join(tempDir, "hooks");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(hookDir, "fork-claude.sh"), "#!/bin/bash\necho 'claude --resume abc'");

      // Mock execSync to return the hook output
      vi.mocked(execSync).mockReturnValue("claude --resume abc\n");

      const session = m.fork("source", "forked");

      // The hook output should be the fork command
      expect(session.command).toBe("claude --resume abc");
      expect(vi.mocked(execSync)).toHaveBeenCalled();
    });

    it("falls back to source command when hook fails", () => {
      const m = mgr();
      createSource(m, "source", "claude");

      // Create hook file
      const hookDir = join(tempDir, "hooks");
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(join(hookDir, "fork-claude.sh"), "#!/bin/bash\nexit 1");

      // Mock execSync to throw (hook failure)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("hook failed");
      });

      const session = m.fork("source", "forked");

      // Should fall back to the source command
      expect(session.command).toBe("claude");
    });

    it("does not run hook when hook file does not exist", () => {
      const m = mgr();
      createSource(m, "source", "claude");
      // No hook file created in tempDir — existsSync returns false

      m.fork("source", "forked");

      // execSync should NOT have been called for hook
      expect(vi.mocked(execSync)).not.toHaveBeenCalled();
    });

    it("persists forked session in DB", () => {
      const m = mgr();
      createSource(m, "source", "bash");
      m.setConfig("forkHooks", "{}");

      m.fork("source", "forked");

      // Make has-session return 0 so list shows sessions
      vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("has-session")) {
          return { status: 0 } as any;
        }
        return { status: 0, stdout: "", stderr: Buffer.from("") } as any;
      });

      const sessions = m.list();
      const forked = sessions.find((s: any) => s.name === "forked");
      expect(forked).toBeDefined();
      expect(forked!.description).toBe("forked from source");
    });
  });
});
