// ── Permission types ──

import type { PermissionMode, PermissionUpdate as SDKPermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type { PermissionMode };
export type PermissionUpdate = SDKPermissionUpdate;

type PermissionUpdateWithDestination = Extract<SDKPermissionUpdate, { destination?: unknown }>;
type AddRulesPermissionUpdate = Extract<SDKPermissionUpdate, { type: "addRules" }>;

export type PermissionUpdateDestination = NonNullable<PermissionUpdateWithDestination["destination"]>;
export type PermissionRuleValue = NonNullable<AddRulesPermissionUpdate["rules"]>[number];

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
