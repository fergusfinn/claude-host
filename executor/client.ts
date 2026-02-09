/**
 * Executor WS client: connects to the control plane, handles reconnection,
 * dispatches incoming RPC to TmuxRunner, sends heartbeats.
 */

import WebSocket from "ws";
import { execSync } from "child_process";
import path from "path";
import type { ControlToExecutorMessage } from "../shared/protocol";
import { TmuxRunner } from "./tmux-runner";
import { openTerminalChannel } from "./terminal-channel";

interface ExecutorClientOpts {
  url: string; // ws://control-plane:3000
  token: string;
  id: string;
  name: string;
  labels: string[];
  version: string;
  noUpgrade?: boolean;
}

export class ExecutorClient {
  private ws: WebSocket | null = null;
  private runner = new TmuxRunner();
  private reconnectDelay = 1000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private upgrading = false;

  constructor(private opts: ExecutorClientOpts) {}

  get isUpgrading(): boolean {
    return this.upgrading;
  }

  start(): void {
    this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }

  private connect(): void {
    if (this.destroyed) return;

    const controlUrl = `${this.opts.url}/ws/executor/control?token=${encodeURIComponent(this.opts.token)}`;
    console.log(`Connecting to ${this.opts.url}...`);

    this.ws = new WebSocket(controlUrl);

    this.ws.on("open", () => {
      console.log("Connected to control plane");
      this.reconnectDelay = 1000;

      // Send register message
      this.send({
        type: "register",
        executorId: this.opts.id,
        name: this.opts.name,
        labels: this.opts.labels,
        version: this.opts.version,
      });

      // Start heartbeat
      this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30000);
    });

    this.ws.on("message", (raw) => {
      let msg: ControlToExecutorMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on("close", () => {
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      console.error(`WebSocket error: ${err.message}`);
      this.cleanup();
      this.scheduleReconnect();
    });
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    console.log(`Reconnecting in ${this.reconnectDelay / 1000}s...`);
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  private send(msg: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendHeartbeat(): void {
    const sessions = this.runner.listSessions();
    this.send({ type: "heartbeat", sessions });
  }

  private async handleMessage(msg: ControlToExecutorMessage): Promise<void> {
    const id = (msg as any).id;

    try {
      switch (msg.type) {
        case "ping":
          this.send({ type: "response", id, ok: true, data: "pong" });
          break;

        case "create_session": {
          const result = this.runner.createSession(msg.opts);
          this.send({ type: "response", id, ok: true, data: result });
          break;
        }

        case "create_job": {
          const result = this.runner.createJob(msg.opts);
          this.send({ type: "response", id, ok: true, data: result });
          break;
        }

        case "delete_session": {
          this.runner.deleteSession(msg.name);
          this.send({ type: "response", id, ok: true });
          break;
        }

        case "fork_session": {
          const result = this.runner.forkSession(msg.opts);
          this.send({ type: "response", id, ok: true, data: result });
          break;
        }

        case "list_sessions": {
          const sessions = this.runner.listSessions();
          this.send({ type: "response", id, ok: true, data: sessions });
          break;
        }

        case "snapshot_session": {
          const snapshot = this.runner.snapshotSession(msg.name, msg.lines);
          this.send({ type: "response", id, ok: true, data: snapshot });
          break;
        }

        case "summarize_session": {
          const summary = await this.runner.summarizeSession(msg.name);
          this.send({ type: "response", id, ok: true, data: summary });
          break;
        }

        case "analyze_session": {
          const analysis = await this.runner.analyzeSession((msg as any).name);
          this.send({ type: "response", id, ok: true, data: analysis });
          break;
        }

        case "attach_session": {
          // Open a terminal channel back to the control plane
          openTerminalChannel({
            baseUrl: this.opts.url,
            token: this.opts.token,
            channelId: msg.channelId,
            sessionName: msg.sessionName,
          });
          this.send({ type: "response", id, ok: true });
          break;
        }

        case "upgrade": {
          if (this.opts.noUpgrade) {
            console.log(`Upgrade requested but --no-upgrade is set, ignoring`);
            break;
          }
          console.log(`Upgrade requested${msg.reason ? `: ${msg.reason}` : ""}`);
          this.upgrading = true;
          this.destroyed = true;
          if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

          // Pull latest code and install deps
          const repoDir = path.resolve(__dirname, "..");
          console.log(`Running git pull && npm install in ${repoDir}...`);
          try {
            execSync("git pull origin main && npm install", {
              cwd: repoDir,
              stdio: "inherit",
            });
          } catch (err: any) {
            console.error(`Upgrade commands failed: ${err.message}`);
          }

          if (this.ws) {
            try { this.ws.close(); } catch {}
          }
          process.exit(42);
          break;
        }

        default:
          this.send({ type: "response", id, ok: false, error: `Unknown message type: ${(msg as any).type}` });
      }
    } catch (err: any) {
      this.send({ type: "response", id, ok: false, error: err.message });
    }
  }
}
