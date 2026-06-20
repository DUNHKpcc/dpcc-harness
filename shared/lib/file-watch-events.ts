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
  const firstSegment = normalized.split("/")[0];
  return WATCH_SKIP_DIRS.has(firstSegment);
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
