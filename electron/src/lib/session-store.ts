import fs from "fs";
import crypto from "crypto";
import { getSessionFilePath } from "./data-dir";
import { reportError } from "./error-utils";
import { getLastUserMessageTimestamp, extractSessionMeta, type SessionMeta } from "@shared/lib/session-persistence";

/**
 * Loose shape accepted by {@link saveSessionToDisk}. Kept structural (not the
 * renderer-only `PersistedSession`) because main-process callers — the
 * `sessions:save` IPC handler and the WeChat session sink — can't import the
 * renderer types, and the value crosses a trust boundary (IPC payload / disk).
 */
export type SessionSaveInput = Record<string, unknown> & {
  projectId: string;
  id: string;
  createdAt?: number;
  messages?: Array<{ role?: string; timestamp?: number }>;
  lastMessageAt?: number;
};

/** Path of the lightweight `.meta.json` sidecar used for fast sidebar listing. */
export function getSessionMetaFilePath(projectId: string, sessionId: string): string {
  return getSessionFilePath(projectId, sessionId).replace(/\.json$/, ".meta.json");
}

const sessionFileOperations = new Map<string, Promise<void>>();
const deletedSessions = new Set<string>();

function getSessionOperationKey(projectId: string, sessionId: string): string {
  return `${projectId}\0${sessionId}`;
}

export function markSessionDeleted(projectId: string, sessionId: string): void {
  deletedSessions.add(getSessionOperationKey(projectId, sessionId));
}

export function unmarkSessionDeleted(projectId: string, sessionId: string): void {
  deletedSessions.delete(getSessionOperationKey(projectId, sessionId));
}

export function isSessionDeleted(projectId: string, sessionId: string): boolean {
  return deletedSessions.has(getSessionOperationKey(projectId, sessionId));
}

export async function withSessionFileLock<T>(
  projectId: string,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = getSessionOperationKey(projectId, sessionId);
  const previous = sessionFileOperations.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  sessionFileOperations.set(key, tail);
  try {
    return await result;
  } finally {
    if (sessionFileOperations.get(key) === tail) {
      sessionFileOperations.delete(key);
    }
  }
}

export async function writeSessionFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, content, "utf-8");
    await fs.promises.rename(tempPath, filePath);
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Persist a session to disk: the full `{id}.json` plus its `{id}.meta.json`
 * sidecar (fire-and-forget). `lastMessageAt` always prefers the latest user
 * message timestamp so the sidebar sorts by activity, not creation time.
 *
 * Single source of truth shared by the `sessions:save` IPC handler and the
 * WeChat bridge (which persists conversations from the main process). Returns the
 * `SessionMeta` it computed so callers can reuse it (e.g. to emit a sidebar
 * upsert) instead of re-deriving the same mapping.
 */
export async function saveSessionToDisk(
  data: SessionSaveInput,
  options?: { restoreDeleted?: boolean },
): Promise<SessionMeta> {
  if (isSessionDeleted(data.projectId, data.id) && !options?.restoreDeleted) {
    throw new Error("Session was deleted");
  }
  const filePath = getSessionFilePath(data.projectId, data.id);
  const providedLastMessageAt = data.lastMessageAt;
  const normalizedProvidedLastMessageAt =
    typeof providedLastMessageAt === "number" ? providedLastMessageAt : undefined;
  const lastMessageAt =
    getLastUserMessageTimestamp(data.messages) ??
    normalizedProvidedLastMessageAt ??
    data.createdAt ??
    0;
  const enriched = { ...data, lastMessageAt };
  const meta = extractSessionMeta(enriched, lastMessageAt);
  const metaPath = getSessionMetaFilePath(data.projectId, data.id);
  const serializedSession = JSON.stringify(enriched);
  const serializedMeta = JSON.stringify(meta);

  await withSessionFileLock(data.projectId, data.id, async () => {
    // Re-check after acquiring the lock. A delete may have been queued ahead
    // of this save while the payload was being serialized.
    const wasDeleted = isSessionDeleted(data.projectId, data.id);
    if (wasDeleted && !options?.restoreDeleted) {
      throw new Error("Session was deleted");
    }
    if (options?.restoreDeleted) {
      unmarkSessionDeleted(data.projectId, data.id);
    }
    try {
      // Temp-file + rename avoids leaving truncated JSON behind if the process
      // exits during a full-history rewrite.
      const writeMain = writeSessionFileAtomically(filePath, serializedSession);
      const writeMeta = writeSessionFileAtomically(metaPath, serializedMeta).catch((err) => {
        reportError("SESSIONS:META_WRITE_ERR", err, { sessionId: data.id });
      });
      await Promise.all([writeMain, writeMeta]);
    } catch (err) {
      if (wasDeleted) {
        markSessionDeleted(data.projectId, data.id);
      }
      throw err;
    }
  });
  return meta;
}
