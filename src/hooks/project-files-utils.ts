export {
  mergeFileWatchEvents,
  normalizeFileWatchPath,
  shouldIgnoreFileWatchPath,
} from "@shared/lib/file-watch-events";
export type { FileWatchEvent, FileWatchSummary } from "@shared/lib/file-watch-events";

export type ProjectFilesRefreshReason =
  | "initial"
  | "manual"
  | "structure-change"
  | "content-change"
  | "focus";

export function shouldFetchProjectFiles({
  reason,
  now,
  lastFetchAt,
  staleMs,
}: {
  reason: ProjectFilesRefreshReason;
  now: number;
  lastFetchAt: number | null;
  staleMs: number;
}): boolean {
  if (reason === "content-change") return false;
  if (reason !== "focus") return true;
  if (lastFetchAt === null) return true;
  return now - lastFetchAt >= staleMs;
}
