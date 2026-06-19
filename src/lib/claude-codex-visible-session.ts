/**
 * Helpers for the visible Codex split pane that Claude opens via `codex_delegate`.
 *
 * `buildDelegatedCodexSession` constructs the `ChatSession` record for the
 * delegated Codex pane; `extractCodexDelegationFinalText` distills the Codex
 * transcript down to the single final reply that is returned to Claude's
 * blocking MCP tool call.
 */
import type { ChatSession, UIMessage } from "@/types";

const DELEGATED_CODEX_TITLE = "Codex delegated task";
const NO_FINAL_TEXT_FALLBACK = "Codex completed without a final assistant message.";

export interface BuildDelegatedCodexSessionInput {
  id: string;
  projectId: string;
  model?: string;
  delegatedFromSessionId: string;
  now: number;
}

export function buildDelegatedCodexSession(input: BuildDelegatedCodexSessionInput): ChatSession {
  return {
    id: input.id,
    projectId: input.projectId,
    title: DELEGATED_CODEX_TITLE,
    createdAt: input.now,
    lastMessageAt: input.now,
    model: input.model,
    totalCost: 0,
    engine: "codex",
    agentId: "codex",
    delegatedFromSessionId: input.delegatedFromSessionId,
    isActive: false,
  };
}

/**
 * Return the most recent assistant message text from a Codex transcript, used
 * as the delegated turn result handed back to Claude. Falls back to a fixed
 * message when the transcript holds no assistant text.
 */
export function extractCodexDelegationFinalText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return message.content;
    }
  }
  return NO_FINAL_TEXT_FALLBACK;
}
