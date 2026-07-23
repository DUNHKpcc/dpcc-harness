import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { reportError } from "../lib/error-utils";
import { saveSessionToDisk, getSessionMetaFilePath } from "../lib/session-store";
import {
  getLastUserMessageTimestamp,
  extractSessionMeta,
  type SessionMeta,
} from "@shared/lib/session-persistence";
import { selectRecentTraySessions } from "../lib/tray-menu";

interface SearchResult {
  messageResults: Array<{
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    messageId: string;
    snippet: string;
    timestamp: number;
  }>;
  sessionResults: Array<{
    sessionId: string;
    projectId: string;
    title: string;
    createdAt: number;
  }>;
}

const getMetaFilePath = getSessionMetaFilePath;

export async function listProjectSessions(projectId: string): Promise<SessionMeta[]> {
  try {
    const dir = getProjectSessionsDir(projectId);
    const allFiles = await fs.promises.readdir(dir);

    // Prefer .meta.json sidecar files for fast listing
    const metaFiles = allFiles.filter((f) => f.endsWith(".meta.json"));
    const metaBasenames = new Set(metaFiles.map((f) => f.replace(/\.meta\.json$/, "")));

    // Find .json files that lack a .meta.json sidecar (migration path)
    const fullParseFiles = allFiles.filter(
      (f) => f.endsWith(".json") && !f.endsWith(".meta.json") && !metaBasenames.has(f.replace(/\.json$/, "")),
    );

    const items = await Promise.all([
      // Fast path: read small sidecar files
      ...metaFiles.map(async (file): Promise<SessionMeta | null> => {
        try {
          const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
          return JSON.parse(raw) as SessionMeta;
        } catch {
          return null;
        }
      }),
      // Fallback: full-file parse for sessions without sidecar
      ...fullParseFiles.map(async (file): Promise<SessionMeta | null> => {
        try {
          const raw = await fs.promises.readFile(path.join(dir, file), "utf-8");
          const data = JSON.parse(raw) as Record<string, unknown>;
          const lastMessageAt: number =
            getLastUserMessageTimestamp(data.messages as Array<{ role?: string; timestamp?: number }>) ??
            (typeof data.lastMessageAt === "number" ? data.lastMessageAt : undefined) ??
            (data.createdAt as number) ??
            0;

          return extractSessionMeta(data, lastMessageAt);
        } catch {
          return null;
        }
      }),
    ]);

    const list: SessionMeta[] = items.filter((item): item is SessionMeta => item !== null);
    // Sort by most recent user activity, not creation time.
    list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return list;
  } catch (err) {
    reportError("SESSIONS:LIST_ERR", err, { projectId });
    return [];
  }
}

export async function listRecentSessions(limit = 3): Promise<SessionMeta[]> {
  try {
    const sessionsRoot = path.join(getDataDir(), "sessions");
    const entries = await fs.promises.readdir(sessionsRoot, { withFileTypes: true });
    const sessions = (await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => listProjectSessions(entry.name)),
    )).flat();

    return selectRecentTraySessions(sessions, limit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      reportError("SESSIONS:RECENT_ERR", err);
    }
    return [];
  }
}

export function register(): void {
  ipcMain.handle("sessions:save", async (_event, data: { projectId: string; id: string; createdAt?: number; messages?: Array<{ role?: string; timestamp?: number }> }) => {
    try {
      await saveSessionToDisk(data);
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:SAVE_ERR", err, { sessionId: data.id });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:load", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      try {
        await fs.promises.access(filePath);
      } catch {
        return null;
      }
      return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
    } catch (err) {
      reportError("SESSIONS:LOAD_ERR", err, { projectId, sessionId });
      return null;
    }
  });

  ipcMain.handle("sessions:list", (_event, projectId: string) =>
    listProjectSessions(projectId));

  ipcMain.handle("sessions:update-meta", async (
    _event,
    { projectId, sessionId, patch }: {
      projectId: string;
      sessionId: string;
      patch: { pinned?: boolean; folderId?: string | null; branch?: string };
    },
  ) => {
    try {
      // Patch the .meta.json sidecar
      const metaPath = getMetaFilePath(projectId, sessionId);
      try {
        const metaRaw = await fs.promises.readFile(metaPath, "utf-8");
        const meta = JSON.parse(metaRaw);
        if ("pinned" in patch) meta.pinned = patch.pinned || undefined;
        if ("folderId" in patch) meta.folderId = patch.folderId || undefined;
        if ("branch" in patch) meta.branch = patch.branch || undefined;
        await fs.promises.writeFile(metaPath, JSON.stringify(meta), "utf-8");
      } catch {
        // meta sidecar missing — will be recreated on next full save
      }

      // Patch the main .json file (read → merge → write)
      const filePath = getSessionFilePath(projectId, sessionId);
      try {
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        if ("pinned" in patch) data.pinned = patch.pinned || undefined;
        if ("folderId" in patch) data.folderId = patch.folderId || undefined;
        if ("branch" in patch) data.branch = patch.branch || undefined;
        await fs.promises.writeFile(filePath, JSON.stringify(data), "utf-8");
      } catch {
        // main file missing — nothing to patch
      }

      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:UPDATE_META_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:delete", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      const metaPath = getMetaFilePath(projectId, sessionId);

      // Delete both main file and sidecar, ignoring ENOENT
      await Promise.all([
        fs.promises.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        }),
        fs.promises.unlink(metaPath).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== "ENOENT") throw err;
        }),
      ]);
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:DELETE_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:search", async (_event, { projectIds, query }: { projectIds: string[]; query: string }): Promise<SearchResult> => {
    try {
      const lowerQuery = query.toLowerCase();
      const messageResults: SearchResult["messageResults"] = [];
      const sessionResults: SearchResult["sessionResults"] = [];

      for (const projectId of projectIds) {
        const dir = path.join(getDataDir(), "sessions", projectId);
        try {
          await fs.promises.access(dir);
        } catch {
          continue;
        }

        const allFiles = await fs.promises.readdir(dir);
        const files = allFiles.filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 5 * 1024 * 1024) continue;

            const raw = await fs.promises.readFile(filePath, "utf-8");
            const data = JSON.parse(raw);
            const sessionTitle = data.title || "Untitled";
            const sessionId = data.id;

            if (sessionTitle.toLowerCase().includes(lowerQuery)) {
              sessionResults.push({
                sessionId,
                projectId,
                title: sessionTitle,
                createdAt: data.createdAt || 0,
              });
            }

            if (messageResults.length >= 10) continue;
            const messages = data.messages || [];
            for (const msg of messages) {
              if (messageResults.length >= 10) break;
              if (msg.role !== "user" && msg.role !== "assistant") continue;
              if (!msg.content || typeof msg.content !== "string") continue;

              const idx = msg.content.toLowerCase().indexOf(lowerQuery);
              if (idx === -1) continue;

              const start = Math.max(0, idx - 30);
              const end = Math.min(msg.content.length, idx + query.length + 50);
              let snippet = msg.content.slice(start, end);
              if (start > 0) snippet = "..." + snippet;
              if (end < msg.content.length) snippet = snippet + "...";

              messageResults.push({
                sessionId,
                projectId,
                sessionTitle,
                messageId: msg.id,
                snippet,
                timestamp: msg.timestamp || data.createdAt || 0,
              });
            }
          } catch {
            // Skip corrupted files
          }
        }
      }

      return { messageResults, sessionResults };
    } catch (err) {
      reportError("SESSIONS:SEARCH_ERR", err, { query });
      return { messageResults: [], sessionResults: [] };
    }
  });
}
