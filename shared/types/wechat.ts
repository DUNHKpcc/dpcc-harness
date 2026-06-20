/**
 * WeChat bridge types shared between electron (main) and renderer.
 *
 * The bridge lets a phone control the built-in Claude Code / Codex CLIs through
 * WeChat's official ClawBot (iLink Bot API). Each inbound message triggers a
 * one-shot CLI run; the reply is streamed back to WeChat.
 *
 * Canonical definitions — import from here, never redefine.
 */

import type { SessionMeta } from "@shared/lib/session-persistence";

/** Which built-in CLI engine handles an inbound WeChat message. */
export type WeChatTool = "claude" | "codex";

/**
 * Permission posture applied to the spawned CLI, mapped per engine:
 * - auto: highest autonomy (Claude bypassPermissions / Codex bypass+full sandbox)
 * - safe: no mutations (Claude read-only tools / Codex read-only sandbox)
 * - plan: read-only planning (Claude plan / Codex read-only sandbox)
 */
export type WeChatPermissionMode = "auto" | "safe" | "plan";

/** User-tunable bridge configuration (persisted in the main process). */
export interface WeChatBridgeConfig {
  /** Auto-start the bridge on app launch when credentials exist. */
  enabled: boolean;
  /** Engine used when a message does not select one via @mention. */
  defaultTool: WeChatTool;
  /** Working directory the CLIs run in (empty = app cwd). */
  workDir: string;
  /**
   * PccAgent project id WeChat conversations are persisted under. Bound to
   * `workDir` (auto-created if empty/stale) so the conversations show up in the
   * sidebar's WeChat area grouped by project.
   */
  projectId: string;
  /**
   * Whitelist of `ilink_user_id`s allowed to drive the bridge.
   * Empty = allow anyone who can message the bot (unsafe — surfaced in UI).
   */
  allowedUsers: string[];
  /** Permission / sandbox posture applied to spawned CLIs. */
  permissionMode: WeChatPermissionMode;
  /** Model override sent to the engine (empty = engine default). */
  model: string;
  /** Max agent turns per message (Claude only). */
  maxTurns: number;
}

/** Coarse connection state surfaced to the UI. */
export type WeChatConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Full bridge state snapshot pushed to the renderer. */
export interface WeChatBridgeState {
  status: WeChatConnectionStatus;
  /** Long-poll loop is actively running. */
  running: boolean;
  /** Persisted login credentials are present. */
  hasCredentials: boolean;
  /** The logged-in bot's own `ilink_user_id`, when known. */
  botUserId: string | null;
  config: WeChatBridgeConfig;
  /** Populated when `status === "error"`. */
  error: string | null;
}

/** QR login progress reported during the scan flow. */
export type WeChatLoginStatus = "wait" | "scaned" | "confirmed" | "expired";

/** Events streamed to the renderer over the `wechat:event` channel. */
export type WeChatBridgeEvent =
  /** Raw string to encode and render as a scannable QR code. */
  | { type: "qrcode"; content: string }
  /** QR scan lifecycle update. */
  | { type: "login-status"; status: WeChatLoginStatus }
  /** Login completed successfully; credentials persisted. */
  | { type: "login-success" }
  /** Login flow failed or was cancelled (cancelled = user-initiated, not an error). */
  | { type: "login-error"; message: string; cancelled?: boolean }
  /** Full state push (connection/config changed). */
  | { type: "state"; state: WeChatBridgeState }
  /** Human-readable activity line for the in-app feed. */
  | { type: "activity"; level: "info" | "warn" | "error"; message: string }
  /** A message crossed the bridge (for the activity feed). */
  | {
      type: "message";
      direction: "in" | "out";
      userId: string;
      tool: WeChatTool | null;
      preview: string;
    }
  /**
   * A WeChat conversation was created or updated as a persisted session — tells
   * the renderer to upsert it into the sidebar's WeChat area immediately, without
   * waiting for a full session-list refresh.
   */
  | { type: "session-upsert"; meta: SessionMeta };
