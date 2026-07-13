import { randomUUID } from "node:crypto";

export type UtilityRequestEngine = "claude" | "acp" | "codex";
export type UtilityRequestPurpose = "title" | "commit" | "prompt";

export interface UtilityRequestEvent {
  _sessionId: string;
  countDelta: number;
  record: {
    id: string;
    engine: UtilityRequestEngine;
    status: "pending" | "completed" | "failed";
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    requestCount: number;
    note: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export function startUtilityRequest(
  emit: (event: UtilityRequestEvent) => void,
  sessionId: string | undefined,
  engine: UtilityRequestEngine,
  purpose: UtilityRequestPurpose,
  options?: { id?: string; now?: () => number },
): ((success: boolean, usage?: { inputTokens?: number; outputTokens?: number }) => void) | undefined {
  if (!sessionId) return undefined;
  const now = options?.now ?? Date.now;
  const startedAt = now();
  const baseRecord = {
    id: options?.id ?? `utility-${purpose}-${randomUUID()}`,
    engine,
    startedAt,
    requestCount: 1,
    note: `utility_${purpose}`,
  };
  emit({
    _sessionId: sessionId,
    countDelta: 1,
    record: { ...baseRecord, status: "pending" },
  });

  let settled = false;
  return (success: boolean, usage) => {
    if (settled) return;
    settled = true;
    const completedAt = now();
    emit({
      _sessionId: sessionId,
      countDelta: 0,
      record: {
        ...baseRecord,
        status: success ? "completed" : "failed",
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        ...usage,
      },
    });
  };
}
