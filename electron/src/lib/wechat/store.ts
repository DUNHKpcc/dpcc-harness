import fs from "node:fs";
import path from "node:path";
import { JsonFileStore } from "../json-file-store";
import { getDataDir } from "../data-dir";
import { reportError } from "../error-utils";
import type { WeChatBridgeConfig } from "@shared/types/wechat";
import type { Credentials } from "./types";
import type { ILinkPersistence } from "./ilink-client";

/** Out-of-the-box bridge config: off, Claude, safe mode, no whitelist. */
export const DEFAULT_WECHAT_CONFIG: WeChatBridgeConfig = {
  enabled: false,
  defaultTool: "claude",
  workDir: "",
  allowedUsers: [],
  permissionMode: "safe",
  model: "",
  maxTurns: 30,
};

const SUB_DIR = "wechat";
const CONFIG_KEY = "config";
const CRED_KEY = "credentials";
const TOKENS_KEY = "context_tokens";

// Credentials and per-user reply tokens are send-capability secrets → encrypt at
// rest (safeStorage). Config is non-sensitive. The encrypted token store also
// transparently migrates the previous plaintext context_tokens.json on first load.
const credStore = new JsonFileStore<Credentials>({ subDir: SUB_DIR, encrypt: true, label: "WECHAT_CRED" });
const configStore = new JsonFileStore<WeChatBridgeConfig>({ subDir: SUB_DIR, label: "WECHAT_CONFIG" });
const tokenStore = new JsonFileStore<Record<string, string>>({ subDir: SUB_DIR, encrypt: true, label: "WECHAT_TOKENS" });

// ─── Config ────────────────────────────────────────────────

export function loadWeChatConfig(): WeChatBridgeConfig {
  const stored = configStore.load(CONFIG_KEY);
  return normalizeConfig({ ...DEFAULT_WECHAT_CONFIG, ...(stored ?? {}) });
}

export function saveWeChatConfig(config: WeChatBridgeConfig): WeChatBridgeConfig {
  const normalized = normalizeConfig(config);
  configStore.save(CONFIG_KEY, normalized);
  return normalized;
}

/**
 * Clamp/whitelist incoming config so a bad renderer patch or arbitrary disk JSON
 * can't break the bridge. Input is typed `unknown` precisely because it crosses a
 * trust boundary (IPC patch / persisted file) — so each runtime guard is honest.
 */
function normalizeConfig(raw: unknown): WeChatBridgeConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: c.enabled === true,
    defaultTool: c.defaultTool === "codex" ? "codex" : "claude",
    workDir: typeof c.workDir === "string" ? c.workDir : "",
    allowedUsers: Array.isArray(c.allowedUsers)
      ? c.allowedUsers.map((u) => String(u).trim()).filter(Boolean)
      : [],
    permissionMode: c.permissionMode === "auto" || c.permissionMode === "plan" ? c.permissionMode : "safe",
    model: typeof c.model === "string" ? c.model.trim() : "",
    maxTurns:
      typeof c.maxTurns === "number" && Number.isFinite(c.maxTurns)
        ? Math.min(200, Math.max(1, Math.floor(c.maxTurns)))
        : 30,
  };
}

// ─── Credentials ───────────────────────────────────────────

export function loadWeChatCredentials(): Credentials | null {
  const creds = credStore.load(CRED_KEY);
  return creds && creds.botToken ? creds : null;
}

export function saveWeChatCredentials(creds: Credentials): void {
  credStore.save(CRED_KEY, creds);
}

export function clearWeChatCredentials(): void {
  credStore.delete(CRED_KEY);
}

// ─── iLink runtime persistence (poll cursor + context tokens) ──────────────

function wechatDir(): string {
  const dir = path.join(getDataDir(), SUB_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const POLL_CURSOR_FILE = () => path.join(wechatDir(), "poll_cursor.txt");

/**
 * Persists the long-poll cursor (plaintext, non-sensitive) and the per-user reply
 * tokens (encrypted) so a restart neither re-runs old commands (cursor) nor loses
 * the ability to reply (tokens).
 */
export const ilinkPersistence: ILinkPersistence = {
  loadPollCursor() {
    try {
      return fs.readFileSync(POLL_CURSOR_FILE(), "utf-8").trim();
    } catch {
      return "";
    }
  },
  savePollCursor(cursor) {
    try {
      fs.writeFileSync(POLL_CURSOR_FILE(), cursor);
    } catch (err) {
      reportError("WECHAT_CURSOR_SAVE", err);
    }
  },
  loadContextTokens() {
    return tokenStore.load(TOKENS_KEY) ?? {};
  },
  saveContextTokens(tokens) {
    try {
      tokenStore.save(TOKENS_KEY, tokens);
    } catch (err) {
      reportError("WECHAT_TOKENS_SAVE", err);
    }
  },
};

/** Wipe all persisted bridge data (used on logout). */
export function clearWeChatRuntimeState(): void {
  tokenStore.delete(TOKENS_KEY);
  try {
    fs.unlinkSync(POLL_CURSOR_FILE());
  } catch {
    /* missing file is fine */
  }
}
