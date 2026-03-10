// Workspace manager — spec §9

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { logger } from "./logger.js";
import { SymphonyError, type Workspace, type HooksConfig } from "./types.js";

export class WorkspaceManager {
  constructor(private root: string) {}

  createForIssue(identifier: string, hooks: HooksConfig): Workspace {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = path.resolve(this.root, workspaceKey);

    // Safety invariant 2: workspace path must stay inside workspace root
    const absRoot = path.resolve(this.root);
    if (!workspacePath.startsWith(absRoot + path.sep) && workspacePath !== absRoot) {
      throw new SymphonyError(
        "invalid_workspace_cwd",
        `Workspace path ${workspacePath} escapes root ${absRoot}`,
      );
    }

    // Ensure root exists
    fs.mkdirSync(this.root, { recursive: true });

    // Check if workspace already exists
    let createdNow = false;
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
      createdNow = true;
    } else if (!fs.statSync(workspacePath).isDirectory()) {
      // Existing non-directory at workspace location — remove and recreate
      fs.rmSync(workspacePath);
      fs.mkdirSync(workspacePath, { recursive: true });
      createdNow = true;
    }

    // Run after_create hook if newly created
    if (createdNow && hooks.after_create) {
      try {
        this.runHook("after_create", hooks.after_create, workspacePath, hooks.timeout_ms);
      } catch (e) {
        // after_create failure is fatal — clean up the workspace
        logger.error("after_create hook failed, removing workspace", {
          workspace: workspacePath,
          error: e instanceof Error ? e.message : String(e),
        });
        try {
          fs.rmSync(workspacePath, { recursive: true, force: true });
        } catch {
          // best effort cleanup
        }
        throw e;
      }
    }

    return { path: workspacePath, workspace_key: workspaceKey, created_now: createdNow };
  }

  removeWorkspace(identifier: string, hooks: HooksConfig): void {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = path.resolve(this.root, workspaceKey);

    if (!fs.existsSync(workspacePath)) return;

    // Run before_remove hook (failure logged and ignored)
    if (hooks.before_remove) {
      try {
        this.runHook("before_remove", hooks.before_remove, workspacePath, hooks.timeout_ms);
      } catch (e) {
        logger.warn("before_remove hook failed (ignored)", {
          workspace: workspacePath,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      logger.info("Removed workspace", { workspace: workspacePath });
    } catch (e) {
      logger.warn("Failed to remove workspace", {
        workspace: workspacePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  runHook(hookName: string, script: string, workspacePath: string, timeoutMs: number): void {
    logger.info(`Running hook ${hookName}`, { workspace: workspacePath });
    try {
      execSync(script, {
        shell: "bash",
        cwd: workspacePath,
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e: any) {
      if (e.killed) {
        throw new SymphonyError(
          "hook_timeout",
          `Hook ${hookName} timed out after ${timeoutMs}ms`,
        );
      }
      throw new SymphonyError(
        "hook_failure",
        `Hook ${hookName} failed: ${e.stderr?.toString().slice(0, 500) || e.message}`,
      );
    }
  }

  getWorkspacePath(identifier: string): string {
    return path.resolve(this.root, sanitizeKey(identifier));
  }

  validateWorkspaceCwd(workspacePath: string): void {
    const absRoot = path.resolve(this.root);
    const absWorkspace = path.resolve(workspacePath);
    if (!absWorkspace.startsWith(absRoot + path.sep) && absWorkspace !== absRoot) {
      throw new SymphonyError(
        "invalid_workspace_cwd",
        `Workspace path ${absWorkspace} is outside root ${absRoot}`,
      );
    }
  }
}

// Safety invariant 3: sanitize workspace key — only [A-Za-z0-9._-]
export function sanitizeKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}
