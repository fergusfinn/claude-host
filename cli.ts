#!/usr/bin/env tsx
/**
 * Unified CLI entry point for claude-host.
 *
 * Usage:
 *   claude-host serve [--port 3000]
 *   claude-host executor --url <ws://...> --token <t> [--id <id>] [--name <n>] [--labels <a,b>]
 */

import { Command } from "commander";

const program = new Command();

program
  .name("claude-host")
  .description("Web-based tmux session manager")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the claude-host web server")
  .option("--port <number>", "Port to listen on", "3000")
  .action(async (opts) => {
    process.env.PORT = process.env.PORT || opts.port;
    await import("./server");
  });

program
  .command("executor")
  .description("Start a remote executor that connects to a claude-host server")
  .requiredOption("--url <url>", "WebSocket URL of the control plane (e.g. ws://host:3000)")
  .option("--token <token>", "Authentication token", "")
  .option("--id <id>", "Executor ID (defaults to hostname)")
  .option("--name <name>", "Human-readable executor name")
  .option("--labels <labels>", "Comma-separated labels")
  .action(async (opts) => {
    if (opts.url) process.env.EXECUTOR_URL = process.env.EXECUTOR_URL || opts.url;
    if (opts.token) process.env.EXECUTOR_TOKEN = process.env.EXECUTOR_TOKEN || opts.token;
    if (opts.id) process.env.EXECUTOR_ID = process.env.EXECUTOR_ID || opts.id;
    if (opts.name) process.env.EXECUTOR_NAME = process.env.EXECUTOR_NAME || opts.name;
    if (opts.labels) process.env.EXECUTOR_LABELS = process.env.EXECUTOR_LABELS || opts.labels;
    await import("./executor/index");
  });

program.parse();
