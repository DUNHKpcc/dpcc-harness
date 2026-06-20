import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { BrowserWindow } from "electron";
import { safeSend } from "../safe-send";
import { reportError } from "../error-utils";
import { saveSessionToDisk } from "../session-store";
import { getSessionFilePath } from "../data-dir";
import { getCCProjectDir, parseJsonlToUIMessages, type CCImportedMessage } from "../../ipc/cc-import";
import { loadWeChatConversations, saveWeChatConversations, type WeChatConversationRecord } from "./store";
import type { SessionMeta } from "@shared/lib/session-persistence";
import type { WeChatBridgeConfig, WeChatBridgeEvent, WeChatTool } from "@shared/types/wechat";

interface SinkDeps {
  getMainWindow: () => BrowserWindow | null;
  getConfig: () => WeChatBridgeConfig;
  emit: (event: WeChatBridgeEvent) => void;
}

/**
 * Bridges headless WeChat runs into PccAgent's standard session store so they
 * appear in the sidebar, persist locally, and can be continued from the desktop.
 *
 * Each `(userId, tool)` thread maps to a stable PccAgent session id. Live SDK
 * events are forwarded over the renderer's existing `claude:event` channel
 * (tagged with that id); the durable transcript is rebuilt from the Claude Code
 * JSONL (written via `persistSession: true`) after every turn.
 */
export class WeChatSessionSink {
  private conversations: Record<string, WeChatConversationRecord>;

  constructor(private readonly deps: SinkDeps) {
    this.conversations = loadWeChatConversations();
  }

  private key(userId: string, tool: WeChatTool): string {
    return `${userId}:${tool}`;
  }

  getRecord(userId: string, tool: WeChatTool): WeChatConversationRecord | undefined {
    return this.conversations[this.key(userId, tool)];
  }

  /** Reverse lookup — used when the desktop continues a WeChat session by its id. */
  getRecordBySessionId(pccSessionId: string): WeChatConversationRecord | undefined {
    return Object.values(this.conversations).find((r) => r.pccSessionId === pccSessionId);
  }

  /** All persisted records — lets the router hydrate its in-memory resume cache on start. */
  allRecords(): WeChatConversationRecord[] {
    return Object.values(this.conversations);
  }

  private persist(): void {
    saveWeChatConversations(this.conversations);
  }

  /**
   * Ensure a stable persisted session exists for `(userId, tool)`; on first
   * creation write a stub holding the user's prompt so it's openable immediately.
   * Always emits a `session-upsert` so the sidebar reflects the new/bumped thread.
   * Returns the stable PccAgent session id used to tag live events.
   */
  async ensureSession(userId: string, tool: WeChatTool, firstPrompt: string): Promise<string> {
    const k = this.key(userId, tool);
    const config = this.deps.getConfig();
    const now = Date.now();
    let rec = this.conversations[k];
    const isNew = !rec;

    if (!rec) {
      rec = {
        userId,
        tool,
        pccSessionId: `wechat-${crypto.randomUUID()}`,
        projectId: config.projectId,
        title: makeTitle(firstPrompt, userId),
        createdAt: now,
        lastUpdatedMs: now,
      };
      this.conversations[k] = rec;
    } else {
      rec.lastUpdatedMs = now;
      // Heal records created before projectId was snapshotted.
      if (!rec.projectId) rec.projectId = config.projectId;
    }
    this.persist();

    // Write a stub on first creation so the session is openable immediately and
    // the sidebar can show it (resume turns already have history on disk).
    if (isNew) {
      const stub: CCImportedMessage[] = [
        { id: `wechat-user-${crypto.randomUUID()}`, role: "user", content: firstPrompt, timestamp: now },
      ];
      const meta = await this.writeSession(rec, stub, config);
      this.deps.emit({ type: "session-upsert", meta });
    }
    return rec.pccSessionId;
  }

  /** Forward a raw SDK event to the renderer, tagged so the existing pipeline routes it. */
  forwardEvent(pccSessionId: string, raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    safeSend(this.deps.getMainWindow, "claude:event", { ...(raw as object), _sessionId: pccSessionId });
  }

  /**
   * Persist the full conversation after a turn completes. For Claude, rebuilds
   * the transcript from the SDK JSONL (authoritative). Falls back to appending a
   * user+assistant pair onto the prior on-disk history (Codex / missing JSONL).
   */
  async finalizeTurn(
    userId: string,
    tool: WeChatTool,
    sdkSessionId: string | undefined,
    turnPrompt: string,
    finalText: string,
    codexResumeMode?: WeChatConversationRecord["codexResumeMode"],
  ): Promise<void> {
    const k = this.key(userId, tool);
    const rec = this.conversations[k];
    if (!rec) return;

    rec.lastUpdatedMs = Date.now();
    if (sdkSessionId) rec.resumeId = sdkSessionId;
    if (codexResumeMode) rec.codexResumeMode = codexResumeMode;
    this.persist();

    const config = this.deps.getConfig();
    const messages = this.rebuildMessages(rec, config, turnPrompt, finalText);
    const meta = await this.writeSession(rec, messages, config);
    this.deps.emit({ type: "session-upsert", meta });
  }

  /** Drop all in-memory + persisted conversation records (logout). */
  clear(): void {
    this.conversations = {};
    this.persist();
  }

  // ── internals ──────────────────────────────────────────────

  private rebuildMessages(
    rec: WeChatConversationRecord,
    config: WeChatBridgeConfig,
    turnPrompt: string,
    finalText: string,
  ): CCImportedMessage[] {
    // Claude: the SDK JSONL is the authoritative full transcript.
    if (rec.tool === "claude" && rec.resumeId) {
      try {
        const dir = getCCProjectDir(config.workDir || os.homedir());
        const filePath = path.join(dir, `${rec.resumeId}.jsonl`);
        if (fs.existsSync(filePath)) {
          const msgs = parseJsonlToUIMessages(filePath);
          if (msgs.length) return msgs;
        }
      } catch (err) {
        reportError("WECHAT_SINK_JSONL", err, { sessionId: rec.pccSessionId });
      }
    }

    // Fallback: append this turn onto whatever history is already on disk.
    // Skip re-adding the user prompt if it's already the last message (the
    // first-turn stub written by ensureSession), to avoid a duplicate.
    const prior = this.readExistingMessages(rec.pccSessionId, rec.projectId);
    const last = prior[prior.length - 1];
    const userAlreadyPresent = !!last && last.role === "user" && last.content === turnPrompt;
    const now = Date.now();
    return [
      ...prior,
      ...(userAlreadyPresent
        ? []
        : [{ id: `wechat-user-${crypto.randomUUID()}`, role: "user", content: turnPrompt, timestamp: now }]),
      { id: `wechat-assistant-${crypto.randomUUID()}`, role: "assistant", content: finalText, timestamp: now },
    ];
  }

  private readExistingMessages(pccSessionId: string, projectId: string): CCImportedMessage[] {
    try {
      const filePath = getSessionFilePath(projectId, pccSessionId);
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { messages?: CCImportedMessage[] };
      return Array.isArray(data.messages) ? data.messages : [];
    } catch {
      return [];
    }
  }

  private writeSession(
    rec: WeChatConversationRecord,
    messages: CCImportedMessage[],
    config: WeChatBridgeConfig,
  ): Promise<SessionMeta> {
    return saveSessionToDisk({
      id: rec.pccSessionId,
      projectId: rec.projectId,
      title: rec.title,
      createdAt: rec.createdAt,
      lastMessageAt: rec.lastUpdatedMs,
      messages,
      model: config.model || undefined,
      permissionMode: config.permissionMode,
      totalCost: 0,
      engine: rec.tool === "codex" ? "codex" : "claude",
      source: "wechat",
      wechatUserId: rec.userId,
    });
  }
}

function makeTitle(prompt: string, userId: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
  return `微信 ${userId.slice(0, 8)}`;
}
