// CLI entry point — spec §17.7

import * as fs from "node:fs";
import * as path from "node:path";
import { Orchestrator } from "./orchestrator.js";
import { logger, setLogLevel } from "./logger.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse --port flag
  let port: number | null = null;
  let workflowPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--debug") {
      setLogLevel("debug");
    } else if (!args[i].startsWith("-")) {
      workflowPath = args[i];
    }
  }

  // Default workflow path
  if (!workflowPath) {
    workflowPath = path.resolve("WORKFLOW.md");
  } else {
    workflowPath = path.resolve(workflowPath);
  }

  // Validate workflow file exists
  if (!fs.existsSync(workflowPath)) {
    logger.error("Workflow file not found", { path: workflowPath });
    process.exit(1);
  }

  logger.info("Symphony starting", { workflow: workflowPath });

  const orchestrator = new Orchestrator(workflowPath);

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    orchestrator.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await orchestrator.start();
  } catch (e) {
    logger.error("Startup failed", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }

  // Start HTTP server if configured
  const config = orchestrator.getConfig();
  const effectivePort = port ?? config.server.port;
  if (effectivePort !== null) {
    const server = createServer(orchestrator);
    server.listen(effectivePort, "127.0.0.1", () => {
      logger.info("HTTP server listening", { port: effectivePort });
    });
  }

  logger.info("Symphony running");
}

main().catch((e) => {
  logger.error("Fatal error", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
