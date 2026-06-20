import fs from "fs";
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
export async function saveSessionToDisk(data: SessionSaveInput): Promise<SessionMeta> {
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

  // Write main session file (no pretty-printing for smaller file size).
  const writeMain = fs.promises.writeFile(filePath, JSON.stringify(enriched), "utf-8");

  // Write metadata sidecar alongside the main write.
  const meta = extractSessionMeta(enriched, lastMessageAt);
  const metaPath = getSessionMetaFilePath(data.projectId, data.id);
  const writeMeta = fs.promises.writeFile(metaPath, JSON.stringify(meta), "utf-8").catch((err) => {
    reportError("SESSIONS:META_WRITE_ERR", err, { sessionId: data.id });
  });

  await Promise.all([writeMain, writeMeta]);
  return meta;
}
