import { getAllLeaves } from "./layout";
import type { TabState } from "@/app/page";

export function tabLabel(tab: TabState): string {
  const leaves = getAllLeaves(tab.layout);
  if (leaves.length === 1) return leaves[0].sessionName;
  return `${leaves[0].sessionName} +${leaves.length - 1}`;
}

export function activityAgo(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixTs);
  if (diff < 5) return "active";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
