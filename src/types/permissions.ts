// ── Permission types ──

import type {
  PermissionMode,
  PermissionRuleValue,
  PermissionUpdate as SharedPermissionUpdate,
} from "@shared/types/engine";

export type { PermissionMode, PermissionRuleValue };
export type PermissionUpdate = SharedPermissionUpdate;
export type PermissionUpdateDestination = Exclude<
  SharedPermissionUpdate["destination"],
  "cliArg"
>;

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  suggestions?: PermissionUpdate[];
  decisionReason?: string;
  /** Original Codex JSON-RPC request id (preserves number vs string type for responses). */
  codexRpcId?: string | number;
}

/**
 * Client-side permission auto-response behavior for ACP sessions.
 * ACP agents provide their own permission options (allow_once, allow_always, etc.).
 * This setting controls whether the client auto-responds or prompts the user.
 */
export type AcpPermissionBehavior = "ask" | "auto_accept" | "allow_all";
