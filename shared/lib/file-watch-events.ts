export interface FileWatchEvent {
  eventType?: string;
  path?: string | null;
}

export interface FileWatchSummary {
  paths: string[];
  hasStructuralChange: boolean;
}

const WATCH_SKIP_DIRS = new Set([".git", ".hg", ".svn", "node_modules"]);

export function normalizeFileWatchPath(filePath?: string | null): string | undefined {
  return filePath ? filePath.split(/[\\/]/).join("/") : undefined;
}

export function shouldIgnoreFileWatchPath(filePath?: string | null): boolean {
  const normalized = normalizeFileWatchPath(filePath);
  if (!normalized) return false;
  // Match ANY path segment, not just the first. A recursive watcher reports
  // paths relative to the watched root, so nested directories (common in
  // monorepos and git worktrees, e.g. "packages/web/node_modules/..." or a
  // worktree's ".git/...") must be ignored too — otherwise an install/build
  // writing into them floods the renderer with file-change events.
  return normalized.split("/").some((segment) => WATCH_SKIP_DIRS.has(segment));
}

export function mergeFileWatchEvents(events: FileWatchEvent[]): FileWatchSummary {
  const paths = new Set<string>();
  let hasStructuralChange = false;

  for (const event of events) {
    if (event.path) paths.add(event.path);
    if (event.eventType === "rename" || !event.path) {
      hasStructuralChange = true;
    }
  }

  return { paths: Array.from(paths), hasStructuralChange };
}
