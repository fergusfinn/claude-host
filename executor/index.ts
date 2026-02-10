#!/usr/bin/env tsx
/**
 * Standalone executor entry point.
 *
 * Usage:
 *   tsx executor/index.ts --url ws://control-plane:3000 --token <token> --id myhost --name "My Machine"
 */

import { execSync } from "child_process";
import path from "path";
import { ExecutorClient } from "./client";

let VERSION: string;
try {
  VERSION = execSync("git rev-parse --short HEAD", {
    encoding: "utf-8",
    cwd: path.resolve(__dirname, ".."),
  }).trim();
} catch {
  VERSION = "unknown";
}

function parseArgs(): { url: string; token: string; id: string; name: string; labels: string[]; noUpgrade: boolean; e2eKey?: string } {
  const args = process.argv.slice(2);
  let url = "";
  let token = "";
  let id = "";
  let name = "";
  let labels: string[] = [];
  let noUpgrade = false;
  let e2eKey = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--url":
        url = args[++i] || "";
        break;
      case "--token":
        token = args[++i] || "";
        break;
      case "--id":
        id = args[++i] || "";
        break;
      case "--name":
        name = args[++i] || "";
        break;
      case "--labels":
        labels = (args[++i] || "").split(",").filter(Boolean);
        break;
      case "--e2e-key":
        e2eKey = args[++i] || "";
        break;
      case "--no-upgrade":
        noUpgrade = true;
        break;
      case "--help":
        console.log(`Usage: tsx executor/index.ts --url <ws://host:port> --token <token> --id <id> --name <name> [--labels a,b,c] [--e2e-key <key>] [--no-upgrade]`);
        process.exit(0);
    }
  }

  // Fall back to env vars
  url = url || process.env.EXECUTOR_URL || "";
  token = token || process.env.EXECUTOR_TOKEN || "";
  id = id || process.env.EXECUTOR_ID || require("os").hostname();
  name = name || process.env.EXECUTOR_NAME || id;
  e2eKey = e2eKey || process.env.EXECUTOR_E2E_KEY || "";

  if (!url) {
    console.error("Error: --url or EXECUTOR_URL is required");
    process.exit(1);
  }

  return { url, token, id, name, labels, noUpgrade, e2eKey: e2eKey || undefined };
}

const opts = parseArgs();
console.log(`Starting executor "${opts.name}" (${opts.id}) v${VERSION}`);
console.log(`Control plane: ${opts.url}`);

if (opts.noUpgrade) console.log("Auto-upgrade disabled (--no-upgrade)");
if (opts.e2eKey) console.log("E2E encryption key provided");
const client = new ExecutorClient({ ...opts, version: VERSION });
client.start();

// Graceful shutdown — preserve exit code 42 during upgrades
process.on("SIGINT", () => {
  console.log("Shutting down...");
  const code = client.isUpgrading ? 42 : 0;
  client.destroy();
  process.exit(code);
});

process.on("SIGTERM", () => {
  console.log("Shutting down...");
  const code = client.isUpgrading ? 42 : 0;
  client.destroy();
  process.exit(code);
});
