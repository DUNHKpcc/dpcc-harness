import type { ACPStartCancellationReason } from "@shared/types/acp";

const CANCELLATION_REASONS = new Set<ACPStartCancellationReason>([
  "user_stop",
  "new_draft",
  "switch_session",
  "deselect",
  "engine_switch",
  "auth_cancel",
  "cleanup",
]);

export function normalizeAcpStartCancellationReason(
  value: unknown,
): ACPStartCancellationReason {
  return typeof value === "string"
    && CANCELLATION_REASONS.has(value as ACPStartCancellationReason)
    ? value as ACPStartCancellationReason
    : "cleanup";
}
