/**
 * TmuxRunner: all tmux subprocess operations, zero DB dependency.
 * Used by both LocalExecutor (in-process) and standalone executor process.
 */

import { execFileSync, spawnSync, execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { CreateSessionOpts, CreateJobOpts, ForkSessionOpts, SessionLiveness, SessionAnalysis } from "../shared/types";

const TMUX = (() => {
  try {
    return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim();
  } catch {
    return "tmux";
  }
})();

// Strip TMUX env var to avoid nesting issues when executor runs inside tmux
delete process.env.TMUX;

export class TmuxRunner {
  tmuxExists(name: string): boolean {
    return spawnSync(TMUX, ["has-session", "-t", name], { stdio: "pipe" }).status === 0;
  }

  getPaneActivity(name: string): number {
    try {
      const r = spawnSync(TMUX, ["display-message", "-t", name, "-p", "#{pane_last_activity}"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      const ts = parseInt(r.stdout?.trim() || "0", 10);
      return ts || Math.floor(Date.now() / 1000);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }

  getPaneCwd(name: string): string | null {
    if (!this.tmuxExists(name)) return null;
    try {
      const r = spawnSync(TMUX, ["display-message", "-t", name, "-p", "#{pane_current_path}"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      return r.stdout?.trim() || null;
    } catch {
      return null;
    }
  }

  createSession(opts: CreateSessionOpts): { name: string; command: string } {
    const { name, command = "claude", defaultCwd } = opts;

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }

    if (this.tmuxExists(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const tmuxArgs = ["new-session", "-d", "-s", name, "-x", "200", "-y", "50"];
    const cwd = defaultCwd || process.cwd();
    mkdirSync(cwd, { recursive: true });
    tmuxArgs.push("-c", cwd);

    const r = spawnSync(TMUX, tmuxArgs, { stdio: "pipe" });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    this.configureTmuxSession(name);

    // For claude commands, generate a session ID
    let launchCommand = command;
    const baseCommand = command.split(/\s+/)[0];
    if (baseCommand === "claude") {
      const sessionId = randomUUID();
      launchCommand = `${command} --session-id ${sessionId}`;
      spawnSync(TMUX, ["set-environment", "-t", name, "CLAUDE_SESSION_ID", sessionId], {
        stdio: "pipe",
      });
    }

    // Launch command
    spawnSync(TMUX, ["send-keys", "-t", name, launchCommand, "Enter"], { stdio: "pipe" });

    return { name, command };
  }

  createJob(opts: CreateJobOpts): { name: string; command: string } {
    const { name, prompt, maxIterations, defaultCwd } = opts;

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }

    if (this.tmuxExists(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const cwd = defaultCwd || join(process.env.HOME || "/tmp", "workspace");
    mkdirSync(cwd, { recursive: true });

    // Create tmux session
    const r = spawnSync(TMUX, ["new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", cwd], { stdio: "pipe" });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    this.configureTmuxSession(name);

    // Write prompt to temp file (avoids shell escaping issues)
    const sessionId = randomUUID();
    const promptFile = `/tmp/claude-job-${sessionId}-prompt.txt`;
    const augmentedPrompt = prompt + "\n\nWhen you have fully completed the task, output exactly <promise>DONE</promise> to signal completion.";
    writeFileSync(promptFile, augmentedPrompt);

    // Write self-contained launcher script with iteration loop
    const outputFile = `/tmp/claude-job-${sessionId}-output.txt`;
    const launcherScript = `/tmp/claude-job-${sessionId}.sh`;
    writeFileSync(launcherScript, [
      "#!/bin/bash",
      `SID=${JSON.stringify(sessionId)}`,
      `PROMPT_FILE=${JSON.stringify(promptFile)}`,
      `OUTPUT_FILE=${JSON.stringify(outputFile)}`,
      `LAUNCHER=${JSON.stringify(launcherScript)}`,
      `MAX_ITER=${maxIterations}`,
      "",
      "cleanup() { rm -f \"$PROMPT_FILE\" \"$OUTPUT_FILE\" \"$LAUNCHER\"; }",
      "trap cleanup EXIT",
      "trap 'exit 0' INT TERM",
      "",
      "PROMPT=$(cat \"$PROMPT_FILE\")",
      "",
      "for (( i=1; i<=MAX_ITER; i++ )); do",
      "  echo \"\"",
      "  echo \"=== Job iteration $i / $MAX_ITER ===\"",
      "  echo \"\"",
      "  if [ $i -eq 1 ]; then",
      "    claude -p --dangerously-skip-permissions --session-id \"$SID\" \"$PROMPT\" | tee \"$OUTPUT_FILE\"",
      "  else",
      "    claude -p --dangerously-skip-permissions --resume \"$SID\" \"Continue working on the task. Output <promise>DONE</promise> when complete.\" | tee \"$OUTPUT_FILE\"",
      "  fi",
      "  if grep -q '<promise>DONE</promise>' \"$OUTPUT_FILE\" 2>/dev/null; then",
      "    echo \"\"",
      "    echo \"=== Job completed (iteration $i) ===\"",
      "    break",
      "  fi",
      "done",
      "",
    ].join("\n"));

    // Store session ID in tmux environment
    spawnSync(TMUX, ["set-environment", "-t", name, "CLAUDE_SESSION_ID", sessionId], { stdio: "pipe" });

    // Launch via tmux send-keys
    spawnSync(TMUX, ["send-keys", "-t", name, `bash ${launcherScript}`, "Enter"], { stdio: "pipe" });

    return { name, command: "claude" };
  }

  deleteSession(name: string): void {
    if (this.tmuxExists(name)) {
      spawnSync(TMUX, ["kill-session", "-t", name], { stdio: "pipe" });
    }
  }

  listSessions(): SessionLiveness[] {
    // List all tmux sessions and check which ones we know about
    try {
      const r = spawnSync(TMUX, ["list-sessions", "-F", "#{session_name}"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      if (r.status !== 0 || !r.stdout) return [];
      return r.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((name) => ({
          name,
          alive: true,
          last_activity: this.getPaneActivity(name),
        }));
    } catch {
      return [];
    }
  }

  snapshotSession(name: string, lines = 50): string {
    if (!this.tmuxExists(name)) return "[session not running]";
    try {
      const r = spawnSync(TMUX, ["capture-pane", "-t", name, "-p", "-S", `-${lines}`], {
        encoding: "utf-8",
        timeout: 2000,
      });
      return r.stdout || "[empty]";
    } catch {
      return "[capture failed]";
    }
  }

  async summarizeSession(name: string): Promise<string> {
    if (!this.tmuxExists(name)) return "";

    let snapshot: string;
    try {
      const r = spawnSync(TMUX, ["capture-pane", "-t", name, "-p", "-S", "-200"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      snapshot = r.stdout || "";
    } catch {
      return "";
    }

    if (!snapshot.trim()) return "";

    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      const child = execFile("claude", [
        "-p",
        "You are looking at terminal output from a coding session. " +
          "Summarize what this session is working on in one brief sentence (max 80 chars). " +
          "Output ONLY the summary sentence, nothing else.",
      ], { timeout: 60000 }, (err, stdout) => {
        if (err || !stdout) { resolve(""); return; }
        resolve(stdout.trim());
      });
      child.stdin?.write(snapshot);
      child.stdin?.end();
    });
  }

  async analyzeSession(name: string): Promise<SessionAnalysis> {
    if (!this.tmuxExists(name)) return { description: "", needs_input: false };

    let snapshot: string;
    try {
      const r = spawnSync(TMUX, ["capture-pane", "-t", name, "-p", "-S", "-200"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      snapshot = r.stdout || "";
    } catch {
      return { description: "", needs_input: false };
    }

    if (!snapshot.trim()) return { description: "", needs_input: false };

    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      const child = execFile("claude", [
        "-p",
        "You are looking at terminal output from a coding session. " +
          'Respond with JSON only: {"description": "<what this session is doing, max 80 chars>", "needs_input": <true if the session is waiting for user input, false if it\'s busy/processing>} ' +
          "needs_input should be true if: the terminal is at a shell prompt, waiting for a Y/n answer, asking for a password, showing a tool approval prompt, or otherwise idle waiting for the user.",
      ], { timeout: 60000 }, (err, stdout) => {
        if (err || !stdout) { resolve({ description: "", needs_input: false }); return; }
        try {
          const raw = stdout.trim();
          // Extract JSON from potential markdown code fences
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (!jsonMatch) { resolve({ description: "", needs_input: false }); return; }
          const parsed = JSON.parse(jsonMatch[0]);
          resolve({
            description: typeof parsed.description === "string" ? parsed.description.slice(0, 120) : "",
            needs_input: !!parsed.needs_input,
          });
        } catch {
          resolve({ description: "", needs_input: false });
        }
      });
      child.stdin?.write(snapshot);
      child.stdin?.end();
    });
  }

  forkSession(opts: ForkSessionOpts): { name: string; command: string } {
    const { sourceName, newName, sourceCommand, sourceCwd, forkHooks } = opts;

    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }
    if (this.tmuxExists(newName)) {
      throw new Error(`Session "${newName}" already exists`);
    }

    // Resolve fork hook
    let forkCommand = sourceCommand;
    const hookKey = Object.keys(forkHooks).find((key) =>
      sourceCommand.split(/\s+/)[0] === key
    );

    if (hookKey) {
      const hookPath = forkHooks[hookKey];
      const resolvedHook = hookPath.startsWith("/")
        ? hookPath
        : resolve(process.cwd(), hookPath);

      if (existsSync(resolvedHook)) {
        try {
          const result = execSync(`bash "${resolvedHook}"`, {
            encoding: "utf-8",
            timeout: 5000,
            env: {
              ...process.env,
              SOURCE_SESSION: sourceName,
              SOURCE_CWD: sourceCwd || process.cwd(),
              SOURCE_COMMAND: sourceCommand,
            },
          });
          const cmd = result.trim();
          if (cmd) forkCommand = cmd;
        } catch {
          // Hook failed — fall back to source command
        }
      } else {
        // No external hook file — use inline fork logic for claude
        forkCommand = this.inlineForkHook(sourceName, sourceCommand);
      }
    }

    // Create tmux session
    const tmuxArgs = ["new-session", "-d", "-s", newName, "-x", "200", "-y", "50"];
    if (sourceCwd) {
      tmuxArgs.push("-c", sourceCwd);
    }
    const r = spawnSync(TMUX, tmuxArgs, { stdio: "pipe" });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    this.configureTmuxSession(newName);
    spawnSync(TMUX, ["send-keys", "-t", newName, forkCommand, "Enter"], { stdio: "pipe" });

    // For forked claude sessions, discover the new session ID
    const forkBaseCommand = forkCommand.split(/\s+/)[0];
    if (forkBaseCommand === "claude" && sourceCwd) {
      this.discoverNewSessionId(newName, sourceCwd);
    }

    return { name: newName, command: forkCommand };
  }

  // --- Private helpers ---

  private configureTmuxSession(name: string): void {
    spawnSync(TMUX, ["set-option", "-t", name, "status", "off"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", name, "mouse", "on"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", name, "history-limit", "50000"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", name, "copy-mode-exit-on-bottom", "on"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-s", "set-clipboard", "on"], { stdio: "pipe" });
  }

  /**
   * Inline fork hook for claude: reads CLAUDE_SESSION_ID from tmux env
   * and produces a `claude --resume <id> --fork-session` command.
   * Equivalent to hooks/fork-claude.sh but without needing the file.
   */
  private inlineForkHook(sourceName: string, sourceCommand: string): string {
    try {
      const r = spawnSync(TMUX, ["show-environment", "-t", sourceName, "CLAUDE_SESSION_ID"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      const output = r.stdout?.trim() || "";
      const match = output.match(/^CLAUDE_SESSION_ID=(.+)$/);
      if (match && match[1]) {
        return `claude --resume ${match[1]} --fork-session`;
      }
    } catch {}
    return sourceCommand;
  }

  /**
   * Snapshot existing JSONL files, then spawn a background shell script that
   * polls for a new file and sets CLAUDE_SESSION_ID on the tmux session.
   */
  private discoverNewSessionId(sessionName: string, cwd: string): void {
    const encodedCwd = cwd.replace(/\//g, "-");
    const projectDir = join(process.env.HOME || "/tmp", ".claude", "projects", encodedCwd);
    if (!existsSync(projectDir)) return;

    // Snapshot existing files
    const before = new Set<string>();
    try {
      const r = spawnSync("ls", [projectDir], { encoding: "utf-8", timeout: 2000 });
      for (const f of (r.stdout || "").split("\n")) {
        if (f.endsWith(".jsonl")) before.add(f);
      }
    } catch { return; }

    const beforeList = [...before].join("\n");

    // Spawn a background process that polls for the new file
    const { spawn: spawnAsync } = require("child_process");
    const child = spawnAsync("bash", ["-c", `
      for i in $(seq 1 20); do
        sleep 0.5
        for f in "${projectDir}"/*.jsonl; do
          [ -f "$f" ] || continue
          name=$(basename "$f")
          if ! echo "${beforeList}" | grep -qF "$name"; then
            sid="\${name%.jsonl}"
            ${TMUX} set-environment -t "${sessionName}" CLAUDE_SESSION_ID "$sid" 2>/dev/null
            exit 0
          fi
        done
      done
    `], { stdio: "ignore", detached: true });
    child.unref();
  }
}
