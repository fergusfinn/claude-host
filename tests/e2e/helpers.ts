import { spawn, spawnSync, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import WebSocket from "ws";
import Database from "better-sqlite3";

const PROJECT_ROOT = join(__dirname, "../..");

// --- Server lifecycle ---

export interface ServerHandle {
  port: number;
  baseUrl: string;
  wsUrl: string;
  process: ChildProcess;
  dataDir: string;
  cleanup: () => void;
}

export async function startServer(): Promise<ServerHandle> {
  const port = 10000 + Math.floor(Math.random() * 50000);
  const dataDir = mkdtempSync(join(tmpdir(), "claude-host-e2e-"));

  const proc = spawn("npx", ["tsx", "server.ts", "--port", String(port)], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      AUTH_DISABLED: "1",
      DATA_DIR: dataDir,
      EXECUTOR_TOKEN: "test-token",
      NODE_ENV: "test",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Wait for the server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server failed to start within 30s"));
    }, 30000);

    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Claude Host running at")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code}: ${stderr}`));
    });
  });

  const cleanup = () => {
    // Kill tmux sessions created by this test server before removing data
    killTestTmuxSessions(dataDir);
    try {
      proc.kill("SIGTERM");
    } catch {}
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  };

  return {
    port,
    baseUrl: `http://localhost:${port}`,
    wsUrl: `ws://localhost:${port}`,
    process: proc,
    dataDir,
    cleanup,
  };
}

// --- API client ---

export function api(baseUrl: string) {
  const json = async (method: string, path: string, body?: unknown) => {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(`${baseUrl}${path}`, opts);
  };

  return {
    sessions: {
      list: () => json("GET", "/api/sessions").then((r) => r.json()),
      create: (opts: { description?: string; command?: string; executor?: string; mode?: string } = {}) =>
        json("POST", "/api/sessions", opts),
      delete: (name: string) => json("DELETE", `/api/sessions/${name}`),
      fork: (source: string) => json("POST", "/api/sessions/fork", { source }),
      snapshot: (name: string) =>
        json("GET", `/api/sessions/${name}/snapshot`).then((r) => r.json()),
      reorder: (names: string[]) => json("PUT", "/api/sessions/reorder", { names }),
      createJob: (opts: { prompt: string; maxIterations?: number; executor?: string; skipPermissions?: boolean }) =>
        json("POST", "/api/sessions/job", opts),
    },
    config: {
      get: () => json("GET", "/api/config").then((r) => r.json()),
      put: (data: Record<string, string>) =>
        json("PUT", "/api/config", data).then((r) => r.json()),
    },
    executors: {
      list: () => json("GET", "/api/executors").then((r) => r.json()),
    },
    executorKeys: {
      list: () => json("GET", "/api/executor-keys").then((r) => r.json()),
      create: (opts: { name?: string; expiresInDays?: number } = {}) =>
        json("POST", "/api/executor-keys", opts).then((r) => r.json()),
      revoke: (id: string) => json("DELETE", `/api/executor-keys/${id}`),
    },
  };
}

// --- Terminal WebSocket helpers ---

export interface TerminalConnection {
  ws: WebSocket;
  output: string;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<string>;
  close: () => void;
}

export function connectTerminal(
  wsUrl: string,
  sessionName: string,
  opts: { cols?: number; rows?: number } = {},
): Promise<TerminalConnection> {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const url = `${wsUrl}/ws/sessions/${sessionName}?cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(url);

  let output = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 10000);

    ws.on("open", () => {
      clearTimeout(timeout);

      ws.on("message", (data: Buffer | string) => {
        output += data.toString();
      });

      const conn: TerminalConnection = {
        ws,
        get output() {
          return output;
        },
        waitFor(pattern: RegExp, timeoutMs = 10000) {
          return new Promise((resolve, reject) => {
            // Check immediately
            if (pattern.test(output)) {
              resolve(output);
              return;
            }
            const timer = setTimeout(() => {
              reject(
                new Error(
                  `Timed out waiting for ${pattern} after ${timeoutMs}ms. Output so far:\n${output.slice(-500)}`,
                ),
              );
            }, timeoutMs);

            const check = () => {
              if (pattern.test(output)) {
                clearTimeout(timer);
                ws.removeListener("message", check);
                resolve(output);
              }
            };
            ws.on("message", check);
          });
        },
        close() {
          ws.close();
        },
      };

      resolve(conn);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --- Rich session WebSocket helpers ---

export interface RichEvent {
  type: string;
  event?: any;
  streaming?: boolean;
  process_alive?: boolean;
  message?: string;
}

export interface RichConnection {
  ws: WebSocket;
  events: RichEvent[];
  sendPrompt: (text: string) => void;
  waitForEvent: (
    predicate: (evt: RichEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<RichEvent>;
  waitForTurnComplete: (timeoutMs?: number) => Promise<void>;
  close: () => void;
}

export function connectRich(
  wsUrl: string,
  sessionName: string,
): Promise<RichConnection> {
  const url = `${wsUrl}/ws/rich/${sessionName}`;
  const ws = new WebSocket(url);
  const events: RichEvent[] = [];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Rich WS connect timeout")), 10000);

    ws.on("open", () => {
      clearTimeout(timeout);

      ws.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          events.push(msg);
        } catch {}
      });

      const conn: RichConnection = {
        ws,
        events,
        sendPrompt(text: string) {
          ws.send(JSON.stringify({ type: "prompt", text }));
        },
        waitForEvent(predicate, timeoutMs = 30000) {
          return new Promise((resolve, reject) => {
            // Check already-received events
            const existing = events.find(predicate);
            if (existing) {
              resolve(existing);
              return;
            }
            const timer = setTimeout(() => {
              reject(
                new Error(
                  `Timed out waiting for event after ${timeoutMs}ms. Events received: ${events.map((e) => e.type).join(", ")}`,
                ),
              );
            }, timeoutMs);

            const check = () => {
              const found = events.find(predicate);
              if (found) {
                clearTimeout(timer);
                ws.removeListener("message", check);
                resolve(found);
              }
            };
            ws.on("message", check);
          });
        },
        waitForTurnComplete(timeoutMs = 60000) {
          return new Promise((resolve, reject) => {
            // Check already-received events (only unmatched ones)
            const idx = events.findIndex((e) => e.type === "turn_complete");
            if (idx >= 0) {
              resolve();
              return;
            }
            const timer = setTimeout(() => {
              reject(
                new Error(
                  `Timed out waiting for turn_complete after ${timeoutMs}ms. Events: ${events.map((e) => e.type).join(", ")}`,
                ),
              );
            }, timeoutMs);

            const check = () => {
              if (events.some((e) => e.type === "turn_complete")) {
                clearTimeout(timer);
                ws.removeListener("message", check);
                resolve();
              }
            };
            ws.on("message", check);
          });
        },
        close() {
          ws.close();
        },
      };

      resolve(conn);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --- Executor process helpers ---

export interface ExecutorHandle {
  process: ChildProcess;
  cleanup: () => void;
}

export async function startExecutor(
  serverUrl: string,
  opts: { id?: string; name?: string } = {},
): Promise<ExecutorHandle> {
  const id = opts.id ?? "test-exec";
  const name = opts.name ?? "Test Executor";

  // Convert http:// to ws://
  const wsUrl = serverUrl.replace(/^http/, "ws");

  const proc = spawn(
    "npx",
    [
      "tsx",
      "executor/index.ts",
      "--url",
      wsUrl,
      "--token",
      "test-token",
      "--id",
      id,
      "--name",
      name,
      "--no-upgrade",
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Executor failed to connect within 15s"));
    }, 15000);

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Connected to control plane")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      // log for debugging
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Executor exited with code ${code}`));
    });
  });

  return {
    process: proc,
    cleanup() {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
  };
}

// --- Cleanup utility ---

/** Kill tmux sessions that were created by a test server's data dir. */
function killTestTmuxSessions(dataDir: string): void {
  try {
    const dbPath = join(dataDir, "sessions.db");
    if (!existsSync(dbPath)) return;

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT name, mode FROM sessions").all() as Array<{ name: string; mode: string }>;
    db.close();

    for (const row of rows) {
      // Terminal sessions use the session name directly; rich sessions use "rich-<name>"
      const tmuxNames = row.mode === "rich" ? [`rich-${row.name}`] : [row.name];
      for (const tName of tmuxNames) {
        spawnSync("tmux", ["kill-session", "-t", tName], { stdio: "pipe" });
      }
    }
  } catch {
    // DB not accessible or tmux not running — best-effort cleanup
  }
}
