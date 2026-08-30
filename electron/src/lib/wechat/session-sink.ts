import crypto from "node:crypto";
import fs from "node:fs";
import type { BrowserWindow } from "electron";
import { BUILTIN_PI_AGENT_ID } from "@shared/types/registry";
import type { SessionMeta } from "@shared/lib/session-persistence";
import type { WeChatBridgeConfig, WeChatBridgeEvent, WeChatTool } from "@shared/types/wechat";
import { getSessionFilePath } from "../data-dir";
import { safeSend } from "../safe-send";
import { isSessionDeleted, saveSessionToDisk } from "../session-store";
import type { AdapterStreamEvent, AdapterTerminal } from "./adapters/types";
import {
  loadWeChatConversations,
  saveWeChatConversations,
  type WeChatConversationRecord,
} from "./store";

interface SinkDeps {
  getMainWindow: () => BrowserWindow | null;
  getConfig: () => WeChatBridgeConfig;
  emit: (event: WeChatBridgeEvent) => void;
}

interface PersistedWeChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isError?: boolean;
}

/** Persists Pi/ACP WeChat turns and forwards their canonical events to the renderer. */
export class WeChatSessionSink {
  private conversations: Record<string, WeChatConversationRecord>;

  constructor(private readonly deps: SinkDeps) {
    this.conversations = loadWeChatConversations();
  }

  private key(userId: string, tool: WeChatTool = "pi"): string {
    return `${userId}:${tool}`;
  }

  getRecord(userId: string): WeChatConversationRecord | undefined {
    return this.conversations[this.key(userId)];
  }

  /** Legacy records remain on disk but can never be selected for execution. */
  getRecordBySessionId(pccSessionId: string): WeChatConversationRecord | undefined {
    return Object.values(this.conversations).find(
      (record) => record.tool === "pi" && record.pccSessionId === pccSessionId,
    );
  }

  allRecords(): WeChatConversationRecord[] {
    return Object.values(this.conversations).filter((record) => record.tool === "pi");
  }

  private persist(): void {
    saveWeChatConversations(this.conversations);
  }

  async ensureSession(userId: string, firstPrompt: string): Promise<string> {
    const key = this.key(userId);
    const config = this.deps.getConfig();
    const now = Date.now();
    let record = this.conversations[key];
    let isNew = !record;

    if (record && isSessionDeleted(record.projectId, record.pccSessionId)) {
      record = {
        ...record,
        tool: "pi",
        pccSessionId: `wechat-${crypto.randomUUID()}`,
        projectId: config.projectId,
        title: makeTitle(firstPrompt, userId),
        createdAt: now,
        lastUpdatedMs: now,
      };
      this.conversations[key] = record;
      isNew = true;
    }

    if (!record) {
      record = {
        userId,
        tool: "pi",
        pccSessionId: `wechat-${crypto.randomUUID()}`,
        projectId: config.projectId,
        title: makeTitle(firstPrompt, userId),
        createdAt: now,
        lastUpdatedMs: now,
      };
      this.conversations[key] = record;
    } else {
      record.lastUpdatedMs = now;
      if (!record.projectId) record.projectId = config.projectId;
    }
    this.persist();

    if (isNew) {
      const messages: PersistedWeChatMessage[] = [{
        id: `wechat-user-${crypto.randomUUID()}`,
        role: "user",
        content: firstPrompt,
        timestamp: now,
      }];
      const meta = await this.writeSession(record, messages, config);
      this.deps.emit({ type: "session-upsert", meta });
    }
    return record.pccSessionId;
  }

  updateResume(userId: string, resumeId: string | undefined): void {
    const record = this.getRecord(userId);
    if (!record) return;
    if (resumeId) record.resumeId = resumeId;
    else delete record.resumeId;
    record.lastUpdatedMs = Date.now();
    this.persist();
  }

  forwardEvent(pccSessionId: string, event: AdapterStreamEvent): void {
    if (!event.update || typeof event.update !== "object") return;
    safeSend(this.deps.getMainWindow, "acp:event", {
      _sessionId: pccSessionId,
      sessionId: event.sessionId,
      update: event.update,
    });
  }

  forwardTerminal(pccSessionId: string, terminal: AdapterTerminal): void {
    if (terminal.kind === "transport_error") {
      safeSend(this.deps.getMainWindow, "acp:turn_transport_error", {
        _sessionId: pccSessionId,
        turnId: terminal.turnId,
        status: "transport_error",
        error: terminal.error,
        outcomeDelivered: false,
      });
      return;
    }

    const { outcome } = terminal;
    safeSend(this.deps.getMainWindow, "acp:turn_complete", {
      _sessionId: pccSessionId,
      turnId: outcome.turnId,
      status: outcome.status,
      ...(outcome.status !== "failed" ? { stopReason: outcome.stopReason } : {}),
      ...(outcome.status === "failed" ? { error: outcome.error } : {}),
      ...(outcome.status === "completed" && outcome.usage !== undefined
        ? { usage: outcome.usage }
        : {}),
      outcome,
      outcomeDelivered: true,
    });
  }

  async finalizeTurn(
    userId: string,
    resumeId: string | undefined,
    turnPrompt: string,
    finalText: string,
    failed: boolean,
  ): Promise<void> {
    const record = this.getRecord(userId);
    if (!record) return;

    record.lastUpdatedMs = Date.now();
    if (resumeId) record.resumeId = resumeId;
    this.persist();

    const config = this.deps.getConfig();
    const messages = this.appendTurn(record, turnPrompt, finalText, failed);
    const meta = await this.writeSession(record, messages, config);
    this.deps.emit({ type: "session-upsert", meta });
  }

  clear(): void {
    this.conversations = {};
    this.persist();
  }

  private appendTurn(
    record: WeChatConversationRecord,
    turnPrompt: string,
    finalText: string,
    failed: boolean,
  ): PersistedWeChatMessage[] {
    const prior = this.readExistingMessages(record.pccSessionId, record.projectId);
    const last = prior[prior.length - 1];
    const userAlreadyPresent = !!last && last.role === "user" && last.content === turnPrompt;
    const now = Date.now();
    return [
      ...prior,
      ...(userAlreadyPresent
        ? []
        : [{
            id: `wechat-user-${crypto.randomUUID()}`,
            role: "user" as const,
            content: turnPrompt,
            timestamp: now,
          }]),
      {
        id: `wechat-${failed ? "error" : "assistant"}-${crypto.randomUUID()}`,
        role: failed ? "system" : "assistant",
        content: finalText,
        timestamp: now,
        ...(failed ? { isError: true } : {}),
      },
    ];
  }

  private readExistingMessages(pccSessionId: string, projectId: string): PersistedWeChatMessage[] {
    try {
      const filePath = getSessionFilePath(projectId, pccSessionId);
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        messages?: PersistedWeChatMessage[];
      };
      return Array.isArray(data.messages) ? data.messages : [];
    } catch {
      return [];
    }
  }

  private writeSession(
    record: WeChatConversationRecord,
    messages: PersistedWeChatMessage[],
    config: WeChatBridgeConfig,
  ): Promise<SessionMeta> {
    const permissionMode = config.permissionMode === "auto"
      ? "bypassPermissions"
      : config.permissionMode === "plan"
        ? "plan"
        : "default";
    return saveSessionToDisk({
      id: record.pccSessionId,
      projectId: record.projectId,
      title: record.title,
      createdAt: record.createdAt,
      lastMessageAt: record.lastUpdatedMs,
      messages,
      model: config.model || undefined,
      permissionMode,
      totalCost: 0,
      engine: "acp",
      agentId: BUILTIN_PI_AGENT_ID,
      agentSessionId: record.resumeId,
      source: "wechat",
      wechatUserId: record.userId,
    });
  }
}

function makeTitle(prompt: string, userId: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
  return `微信 ${userId.slice(0, 8)}`;
}
