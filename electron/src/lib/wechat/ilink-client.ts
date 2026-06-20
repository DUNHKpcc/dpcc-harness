import { randomUUID } from "node:crypto";
import { log } from "../logger";
import { generateWechatUin } from "./crypto";
import { fetchWithRetry } from "./http";
import type {
  Credentials,
  WeixinMessage,
  GetUpdatesResponse,
  MessageItem,
  GetConfigResponse,
} from "./types";

const CHANNEL_VERSION = "1.0.2";
const HTTP_TIMEOUT_MS = 45_000;
const REGULAR_RETRY_DELAYS_MS = [0, 30_000, 60_000, 120_000] as const;
const BASE_RATE_LIMIT_COOLDOWN_MS = 150_000; // ~2.5 min
const MAX_RATE_LIMIT_COOLDOWN_MS = 420_000; // ~7 min
const MAX_CONTEXT_TOKENS = 500; // bound the per-user reply-token cache (persisted)

/** Pluggable persistence so the bridge can survive restarts without re-running old commands. */
export interface ILinkPersistence {
  loadPollCursor(): string;
  savePollCursor(cursor: string): void;
  loadContextTokens(): Record<string, string>;
  saveContextTokens(tokens: Record<string, string>): void;
}

interface UserRateLimitState {
  consecutiveRet2: number;
  blockAllSendsUntil: number;
}

/** Handler invoked for each fresh inbound user message (text already parsed). */
export type MessageHandler = (msg: WeixinMessage, text: string, refText: string) => void;

/**
 * iLink Bot API client: long-polls WeChat for inbound messages and sends text
 * replies + typing indicators. Media upload/download is intentionally omitted.
 */
export class ILinkClient {
  private credentials: Credentials;
  private readonly persistence: ILinkPersistence;
  private pollCursor: string;
  private running = false;
  private contextTokens = new Map<string, string>();
  private typingTickets = new Map<string, { ticket: string; ts: number }>();
  private handlers: MessageHandler[] = [];
  private sendQueues = new Map<string, Promise<void>>();
  private rateLimitStates = new Map<string, UserRateLimitState>();
  private backoffMs = 1000;
  private abortController: AbortController | null = null;
  private consecutiveFailures = 0;
  private longPollTimeoutMs = HTTP_TIMEOUT_MS;
  private reloginInFlight = false;
  private onReloginNeeded?: () => Promise<Credentials | null>;
  // Bounded de-dup: the long-poll cursor can re-deliver a message (at-least-once),
  // and re-running a CLI command is harmful. Keyed per-user (from_user_id:message_id).
  private seenMsgIds = new Set<string>();
  private seenMsgOrder: string[] = [];

  constructor(credentials: Credentials, persistence: ILinkPersistence) {
    this.credentials = credentials;
    this.persistence = persistence;
    this.pollCursor = persistence.loadPollCursor();
    this.contextTokens = new Map(Object.entries(persistence.loadContextTokens()));
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  /** Self-heal on session expiry: re-run login, persist creds, return them. */
  setReloginHandler(handler: () => Promise<Credentials | null>): void {
    this.onReloginNeeded = handler;
  }

  updateCredentials(credentials: Credentials): void {
    this.credentials = credentials;
  }

  isRunning(): boolean {
    return this.running;
  }

  private isFreshMessage(userId: string, id: number): boolean {
    const key = `${userId}:${id}`;
    if (this.seenMsgIds.has(key)) return false;
    this.seenMsgIds.add(key);
    this.seenMsgOrder.push(key);
    if (this.seenMsgOrder.length > 1000) {
      const evict = this.seenMsgOrder.shift();
      if (evict !== undefined) this.seenMsgIds.delete(evict);
    }
    return true;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${this.credentials.botToken}`,
      "X-WECHAT-UIN": generateWechatUin(),
    };
  }

  private baseInfo() {
    return { channel_version: CHANNEL_VERSION };
  }

  // ─── Lifecycle ─────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    log("WECHAT", "iLink 消息轮询已启动");
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    log("WECHAT", "iLink 消息轮询已停止");
  }

  // ─── Long-polling loop ─────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const msgs = await this.getUpdates();
        this.backoffMs = 1000;
        this.consecutiveFailures = 0;
        for (const msg of msgs) {
          await this.processMessage(msg);
        }
      } catch (err: unknown) {
        if (!this.running) return;

        const error = err as { name?: string; errcode?: number; message?: string };
        if (error.name === "AbortError") continue; // normal long-poll timeout

        if (error.errcode === -14 || error.errcode === -13) {
          if (await this.handleSessionExpired()) continue;
          log("WECHAT", "会话已过期，自动重新登录未成功，稍后重试");
          await sleep(30_000);
          continue;
        }

        this.consecutiveFailures += 1;
        log("WECHAT", `轮询错误 (${this.consecutiveFailures}): ${error.message || String(err)}`);

        const jittered = Math.floor(this.backoffMs * (0.5 + Math.random() * 0.5));
        await sleep(jittered);
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      }
    }
  }

  private async handleSessionExpired(): Promise<boolean> {
    if (!this.onReloginNeeded || this.reloginInFlight) return false;
    this.reloginInFlight = true;
    try {
      log("WECHAT", "会话已过期，正在尝试重新登录…");
      const creds = await this.onReloginNeeded();
      if (creds) {
        this.credentials = creds;
        this.consecutiveFailures = 0;
        this.backoffMs = 1000;
        log("WECHAT", "重新登录成功，继续运行");
        return true;
      }
      return false;
    } catch (err) {
      log("WECHAT", `自动重新登录失败: ${(err as Error).message}`);
      return false;
    } finally {
      this.reloginInFlight = false;
    }
  }

  private async getUpdates(): Promise<WeixinMessage[]> {
    this.abortController = new AbortController();
    const timer = setTimeout(() => this.abortController?.abort(), this.longPollTimeoutMs);

    try {
      const res = await fetchWithRetry(`${this.credentials.baseUrl}/ilink/bot/getupdates`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ get_updates_buf: this.pollCursor, base_info: this.baseInfo() }),
        signal: this.abortController.signal,
        label: "getupdates",
        retries: 2,
        retryOnHttpError: true,
        timeoutMs: this.longPollTimeoutMs + 15_000,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as GetUpdatesResponse;

      // API omits ret/errcode on success; only check when explicitly present and non-zero.
      if (data.ret !== undefined && data.ret !== 0) {
        const e: Error & { errcode?: number } = new Error(data.errmsg || `ret=${data.ret}`);
        e.errcode = data.errcode;
        throw e;
      }

      const serverMs = data.longpolling_timeout_ms;
      if (typeof serverMs === "number" && Number.isFinite(serverMs) && serverMs > 0) {
        this.longPollTimeoutMs = Math.min(120_000, Math.max(10_000, serverMs + 5_000));
      }

      if (data.get_updates_buf) {
        this.pollCursor = data.get_updates_buf;
        this.persistence.savePollCursor(this.pollCursor);
      }

      return data.msgs || [];
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Message handling ──────────────────────────────────

  private async processMessage(msg: WeixinMessage): Promise<void> {
    if (msg.message_type !== 1) return; // user messages only
    if (!this.isFreshMessage(msg.from_user_id, msg.message_id)) return;

    // Cache the per-user reply token; only rewrite the persisted file when it
    // actually changed (avoids a sync disk write on every message). The map is
    // bounded so an allow-all spray of distinct users can't grow it unbounded.
    if (this.contextTokens.get(msg.from_user_id) !== msg.context_token) {
      this.setContextToken(msg.from_user_id, msg.context_token);
      this.persistence.saveContextTokens(Object.fromEntries(this.contextTokens));
    }

    const { text, refText } = parseMessage(msg);
    if (!text && !refText) return;

    for (const handler of this.handlers) {
      try {
        handler(msg, text, refText);
      } catch (err) {
        log("WECHAT", `消息处理器异常: ${(err as Error).message}`);
      }
    }
  }

  getContextToken(userId: string): string | undefined {
    return this.contextTokens.get(userId);
  }

  /** Set a user's reply token, evicting the oldest entry past the cap (Map keeps insertion order). */
  private setContextToken(userId: string, token: string): void {
    if (!this.contextTokens.has(userId) && this.contextTokens.size >= MAX_CONTEXT_TOKENS) {
      const oldest = this.contextTokens.keys().next().value;
      if (oldest !== undefined) this.contextTokens.delete(oldest);
    }
    this.contextTokens.set(userId, token);
  }

  /** True while a rate-limit cooldown blocks all sends to this user. */
  private isSendBlocked(userId: string): boolean {
    return Date.now() < (this.rateLimitStates.get(userId)?.blockAllSendsUntil ?? 0);
  }

  // ─── Sending ───────────────────────────────────────────

  private enqueueSend(userId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.sendQueues.get(userId) || Promise.resolve();
    const run = prev.then(task, task);
    const tracked = run.catch(() => {});
    this.sendQueues.set(userId, tracked);
    return run.finally(() => {
      if (this.sendQueues.get(userId) === tracked) this.sendQueues.delete(userId);
    });
  }

  private getRateLimitState(userId: string): UserRateLimitState {
    const state = this.rateLimitStates.get(userId) || { consecutiveRet2: 0, blockAllSendsUntil: 0 };
    this.rateLimitStates.set(userId, state);
    return state;
  }

  private isRateLimitedError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("ret=-2");
  }

  private nextCooldownMs(consecutiveRet2: number): number {
    const steps = Math.max(0, consecutiveRet2 - 2);
    return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, BASE_RATE_LIMIT_COOLDOWN_MS + steps * 60_000);
  }

  private async gateSendWindow(userId: string): Promise<void> {
    const state = this.getRateLimitState(userId);
    const now = Date.now();
    if (now < state.blockAllSendsUntil) {
      const waitMs = state.blockAllSendsUntil - now;
      log("WECHAT", `命中限流冷却窗口，延迟发送 ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  async sendText(userId: string, text: string): Promise<void> {
    const token = this.contextTokens.get(userId);
    if (!token) {
      log("WECHAT", `无法发送给 ${userId}: 缺少 context_token (用户需先发一条消息)`);
      return;
    }
    await this.gateSendWindow(userId);

    await this.enqueueSend(userId, async () => {
      const chunks = chunkText(text, 2000);
      for (const chunk of chunks) {
        await this.sendRawMessageWithRetry(userId, token, [
          { type: 1 as const, text_item: { text: chunk } },
        ]);
      }
    });
  }

  private async sendRawMessageWithRetry(
    userId: string,
    contextToken: string,
    itemList: MessageItem[],
  ): Promise<void> {
    const state = this.getRateLimitState(userId);
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < REGULAR_RETRY_DELAYS_MS.length; attempt++) {
      const delay = REGULAR_RETRY_DELAYS_MS[attempt];
      if (delay > 0) await sleep(delay);
      await this.gateSendWindow(userId);

      try {
        await this.sendRawMessage(userId, contextToken, itemList);
        state.consecutiveRet2 = 0;
        state.blockAllSendsUntil = 0;
        return;
      } catch (err) {
        lastErr = err;
        const isRateLimited = this.isRateLimitedError(err);
        if (isRateLimited) {
          state.consecutiveRet2 += 1;
          const cooldownMs = this.nextCooldownMs(state.consecutiveRet2);
          state.blockAllSendsUntil = Math.max(state.blockAllSendsUntil, Date.now() + cooldownMs);
          log("WECHAT", `命中限流 ret=-2，冷却 ${Math.round(cooldownMs / 1000)}s (连续${state.consecutiveRet2}次)`);
        }
        if (!isRateLimited || attempt === REGULAR_RETRY_DELAYS_MS.length - 1) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("发送消息失败");
  }

  private async sendRawMessage(
    userId: string,
    contextToken: string,
    itemList: MessageItem[],
  ): Promise<void> {
    const res = await fetchWithRetry(`${this.credentials.baseUrl}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        msg: {
          from_user_id: "",
          to_user_id: userId,
          client_id: randomUUID(),
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: itemList,
        },
        base_info: this.baseInfo(),
      }),
      label: "send",
      retries: 2,
      timeoutMs: 30_000,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`发送消息失败: HTTP ${res.status} ${body}`);
    }

    const data = (await res.json()) as { ret?: number; errmsg?: string };
    if (data.ret !== undefined && data.ret !== 0) {
      throw new Error(`发送消息失败: ${data.errmsg || `ret=${data.ret}`}`);
    }
  }

  // ─── Typing indicator ─────────────────────────────────

  async startTyping(userId: string): Promise<() => void> {
    const contextToken = this.contextTokens.get(userId);
    if (!contextToken) return () => {};

    try {
      const ticket = await this.getTypingTicket(userId, contextToken);
      if (!ticket) return () => {};

      await this.sendTypingStatus(userId, ticket, 1).catch(() => {});
      const interval = setInterval(() => {
        // Don't hammer the typing endpoint while a rate-limit cooldown is active —
        // it's futile and would only deepen the limit.
        if (this.isSendBlocked(userId)) return;
        this.sendTypingStatus(userId, ticket, 1).catch(() => {});
      }, 5000);

      return () => {
        clearInterval(interval);
        void this.sendTypingStatus(userId, ticket, 2).catch(() => {});
      };
    } catch {
      return () => {};
    }
  }

  private async getTypingTicket(userId: string, contextToken: string): Promise<string | null> {
    const cached = this.typingTickets.get(userId);
    if (cached && Date.now() - cached.ts < 20 * 3600_000) return cached.ticket;

    const res = await fetchWithRetry(`${this.credentials.baseUrl}/ilink/bot/getconfig`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ilink_user_id: userId,
        context_token: contextToken,
        base_info: this.baseInfo(),
      }),
      label: "getconfig",
      retries: 1,
      timeoutMs: 15_000,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as GetConfigResponse;
    if (data.ret !== 0 || !data.typing_ticket) return null;

    this.typingTickets.set(userId, { ticket: data.typing_ticket, ts: Date.now() });
    return data.typing_ticket;
  }

  private async sendTypingStatus(userId: string, ticket: string, status: 1 | 2): Promise<void> {
    await fetchWithRetry(`${this.credentials.baseUrl}/ilink/bot/sendtyping`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ilink_user_id: userId,
        typing_ticket: ticket,
        status,
        base_info: this.baseInfo(),
      }),
      label: "sendtyping",
      retries: 0,
      timeoutMs: 10_000,
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseMessage(msg: WeixinMessage): { text: string; refText: string } {
  const parts: string[] = [];
  let refText = "";

  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.type === 3 && item.voice_item?.text) {
      parts.push(item.voice_item.text); // voice-to-text transcription
    }
    const ref = item.ref_msg;
    if (ref) {
      const refItem = ref.message_item;
      if (refItem?.text_item?.text) refText = refItem.text_item.text;
      else if (refItem?.voice_item?.text) refText = refItem.voice_item.text;
      else if (ref.title) refText = ref.title;
    }
  }

  // WeChat embeds quoted content inline as "[引用]:\n<content>" — strip the prefix.
  const text = parts.join("\n").trim().replace(/^\[引用\]:\n?/, "");
  return { text, refText };
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf("\n\n", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf("\n", maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf(" ", maxLen);
    if (idx < maxLen * 0.3) idx = maxLen;
    chunks.push(remaining.substring(0, idx));
    remaining = remaining.substring(idx).trimStart();
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
