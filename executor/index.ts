#!/usr/bin/env tsx
/**
 * Standalone executor entry point.
 *
 * Usage:
 *   tsx executor/index.ts --url ws://control-plane:3000 --token <token> --id myhost --name "My Machine"
 */

import { ExecutorClient } from "./client";

function parseArgs(): { url: string; token: string; id: string; name: string; labels: string[] } {
  const args = process.argv.slice(2);
  let url = "";
  let token = "";
  let id = "";
  let name = "";
  let labels: string[] = [];

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
      case "--help":
        console.log(`Usage: tsx executor/index.ts --url <ws://host:port> --token <token> --id <id> --name <name> [--labels a,b,c]`);
        process.exit(0);
    }
  }

  // Fall back to env vars
  url = url || process.env.EXECUTOR_URL || "";
  token = token || process.env.EXECUTOR_TOKEN || "";
  id = id || process.env.EXECUTOR_ID || require("os").hostname();
  name = name || process.env.EXECUTOR_NAME || id;

  if (!url) {
    console.error("Error: --url or EXECUTOR_URL is required");
    process.exit(1);
  }

  return { url, token, id, name, labels };
}

const opts = parseArgs();
console.log(`Starting executor "${opts.name}" (${opts.id})`);
console.log(`Control plane: ${opts.url}`);

const client = new ExecutorClient(opts);
client.start();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down...");
  client.destroy();
  process.exit(0);
});
