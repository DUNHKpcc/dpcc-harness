// ── Permission types ──

import type { PermissionMode, PermissionUpdate as SDKPermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type { PermissionMode };
export type PermissionUpdate = SDKPermissionUpdate;

export type PermissionUpdateDestination = SDKPermissionUpdate extends infer Update
  ? Update extends { destination?: infer Destination }
    ? NonNullable<Destination>
    : never
  : never;

export type PermissionRuleValue = SDKPermissionUpdate extends infer Update
  ? Update extends { type: "addRules"; rules?: infer Rules }
    ? Rules extends ReadonlyArray<infer Rule>
      ? Rule
      : never
    : never
  : never;

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
