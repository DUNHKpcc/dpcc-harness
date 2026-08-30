import type { UIMessage } from "@/types";
import {
  finalizeInterruptedMessages as finalizeSharedInterruptedMessages,
  markInFlightToolCallsFailed as markSharedInFlightToolCallsFailed,
} from "@shared/lib/session-recovery";

export function markInFlightToolCallsFailed(
  messages: UIMessage[],
  reason: string,
): UIMessage[] {
  return markSharedInFlightToolCallsFailed(messages, reason);
}

/**
 * Runtime-only progress flags cannot survive an application restart. Finalize
 * them before rendering persisted history so interrupted tools do not keep
 * showing spinners or streaming animations without a backing process.
 */
export function finalizeInterruptedMessages(
  messages: UIMessage[],
  reason = "PccAgent exited before this operation completed.",
): UIMessage[] {
  return finalizeSharedInterruptedMessages(messages, reason);
}
