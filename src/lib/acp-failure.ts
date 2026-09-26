import type { ACPErrorDetails } from "@/types";
import { createSystemMessage } from "./message-factory";

export interface AcpFailureRecovery {
  recoveryMessageId?: string;
  recoveryPrompt?: {
    content: string;
    displayContent?: string;
    images?: import("@/types").ImageAttachment[];
  };
}

function isRateLimit(error: Partial<ACPErrorDetails> | undefined): boolean {
  return error?.httpStatus === 429
    || /\b429\b|rate.?limit|too many requests/i.test(error?.message ?? "");
}

function recoveryAction(error: Partial<ACPErrorDetails> | undefined): "retry" | undefined {
  return error?.recoveryAction === "retry" || error?.retryable ? "retry" : undefined;
}

/** Build one stable presentation for active and background ACP failures. */
export function createAcpFailureMessage(
  error: Partial<ACPErrorDetails> | undefined,
  recovery: AcpFailureRecovery = {},
) {
  const detail = error?.message?.trim() || "ACP prompt failed.";
  const content = isRateLimit(error)
    ? `ACP prompt error: API rate limit reached (HTTP 429). The answer was not completed. ${detail}`
    : `ACP prompt error: ${detail}`;
  return createSystemMessage(content, true, {
    failureStatus: "failed_before_completion",
    recoveryAction: recoveryAction(error),
    ...recovery,
  });
}

export function createPersistenceFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "Unknown persistence error");
  return createSystemMessage(
    `Session history could not be saved locally (persistence_failed): ${detail}`,
    true,
    { failureStatus: "persistence_failed" },
  );
}
