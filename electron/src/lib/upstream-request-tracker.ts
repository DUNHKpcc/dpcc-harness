import { randomUUID } from "node:crypto";

export type UtilityRequestEngine = "claude" | "acp" | "codex";
export type UtilityRequestPurpose = "title" | "commit" | "prompt";

export interface UtilityRequestUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningOutputTokens?: number;
  costUSD?: number;
}

export interface AcpPromptUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  thoughtTokens?: number | null;
}

export function mergeUtilityRequestUsage(
  ...sources: Array<UtilityRequestUsage | null | undefined>
): UtilityRequestUsage | undefined {
  const merged: UtilityRequestUsage = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null && value !== "") {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function utilityRequestUsageFromAcp(
  usage: AcpPromptUsage | null | undefined,
  model?: string,
): UtilityRequestUsage | undefined {
  return mergeUtilityRequestUsage(
    model?.trim() ? { model: model.trim() } : undefined,
    usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cachedReadTokens ?? undefined,
          cacheCreationTokens: usage.cachedWriteTokens ?? undefined,
          reasoningOutputTokens: usage.thoughtTokens ?? undefined,
        }
      : undefined,
  );
}

export interface UtilityRequestEvent {
  _sessionId: string;
  countDelta: number;
  record: {
    id: string;
    turnId?: string;
    engine: UtilityRequestEngine;
    status: "pending" | "completed" | "cancelled" | "failed";
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    requestCount: number;
    note: string;
    errorCode?: string;
    errorMessage?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    reasoningOutputTokens?: number;
    costUSD?: number;
  };
}

export function startUtilityRequest(
  emit: (event: UtilityRequestEvent) => void,
  sessionId: string | undefined,
  engine: UtilityRequestEngine,
  purpose: UtilityRequestPurpose,
  options?: { id?: string; turnId?: string; model?: string; now?: () => number },
): ((
  success: boolean,
  usage?: UtilityRequestUsage,
  failure?: { code?: string; message?: string; status?: "failed" | "cancelled" },
) => void) | undefined {
  if (!sessionId) return undefined;
  const now = options?.now ?? Date.now;
  const startedAt = now();
  const baseRecord = {
    id: options?.id ?? `utility-${purpose}-${randomUUID()}`,
    ...(options?.turnId ? { turnId: options.turnId } : {}),
    ...(options?.model?.trim() ? { model: options.model.trim() } : {}),
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
  return (success: boolean, usage, failure) => {
    if (settled) return;
    settled = true;
    const completedAt = now();
    emit({
      _sessionId: sessionId,
      countDelta: 0,
      record: {
        ...baseRecord,
        status: failure?.status ?? (success ? "completed" : "failed"),
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        ...usage,
        ...(failure?.code ? { errorCode: failure.code } : {}),
        ...(failure?.message ? { errorMessage: failure.message } : {}),
        ...(failure?.code ? { note: `${baseRecord.note}:${failure.code}` } : {}),
      },
    });
  };
}
