import { execFileSync } from "child_process";

export const TMUX = (() => {
  try {
    return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim();
  } catch {
    return "tmux";
  }
})();
