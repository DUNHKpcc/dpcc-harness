import type {
  CodexTokenUsageNotification,
  ModelUsageEntry,
  ResultEvent,
  UpstreamModelUsageBreakdown,
  UpstreamRequestRecord,
} from "@/types";

export const RECENT_UPSTREAM_REQUEST_LIMIT = 10;

function sum(values: Array<number | undefined>): number | undefined {
  const total = values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
  return total > 0 ? total : undefined;
}

function getClaudeBreakdown(
  modelUsage: ResultEvent["modelUsage"] | undefined,
): UpstreamModelUsageBreakdown[] {
  if (!modelUsage) return [];
  return Object.entries(modelUsage).map(([model, usage]: [string, ModelUsageEntry]) => ({
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheCreationTokens: usage.cacheCreationInputTokens,
    webSearchRequests: usage.webSearchRequests,
    costUSD: usage.costUSD,
    contextWindow: usage.contextWindow,
  }));
}

export function trimUpstreamRequestLog(
  requestLog: UpstreamRequestRecord[] | undefined,
): UpstreamRequestRecord[] {
  return (requestLog ?? []).slice(-RECENT_UPSTREAM_REQUEST_LIMIT);
}

export function appendUpstreamRequestRecord(
  requestLog: UpstreamRequestRecord[] | undefined,
  record: UpstreamRequestRecord,
): UpstreamRequestRecord[] {
  return trimUpstreamRequestLog([...(requestLog ?? []), record]);
}

export function getUpstreamRequestCount(
  requestLog: UpstreamRequestRecord[] | undefined,
  upstreamRequestCount?: number,
): number {
  if (typeof upstreamRequestCount === "number" && upstreamRequestCount > 0) {
    return upstreamRequestCount;
  }
  return (requestLog ?? []).reduce((total, record) => total + Math.max(1, record.requestCount || 1), 0);
}

export function createClaudeRequestRecord(
  event: ResultEvent,
  ordinal: number,
  fallbackModel?: string,
  now = Date.now(),
): UpstreamRequestRecord {
  const modelBreakdown = getClaudeBreakdown(event.modelUsage);
  const model = modelBreakdown.length === 1
    ? modelBreakdown[0].model
    : fallbackModel;
  const durationMs = event.duration_ms ?? 0;

  return {
    id: `claude-result-${event.session_id}-${ordinal}`,
    engine: "claude",
    ...(model ? { model } : {}),
    status: event.is_error ? "failed" : "completed",
    startedAt: Math.max(0, now - durationMs),
    completedAt: now,
    requestCount: Math.max(1, event.num_turns || 1),
    inputTokens: sum(modelBreakdown.map((entry) => entry.inputTokens)),
    outputTokens: sum(modelBreakdown.map((entry) => entry.outputTokens)),
    cacheReadTokens: sum(modelBreakdown.map((entry) => entry.cacheReadTokens)),
    cacheCreationTokens: sum(modelBreakdown.map((entry) => entry.cacheCreationTokens)),
    durationMs,
    costUSD: event.total_cost_usd ?? sum(modelBreakdown.map((entry) => entry.costUSD)),
    ...(modelBreakdown.length > 0 ? { modelBreakdown } : {}),
    ...(event.num_turns > 1 ? { note: "claude_aggregated_result" } : {}),
  };
}

interface CodexRequestUpdate {
  turnId: string;
  status?: UpstreamRequestRecord["status"];
  model?: string;
  tokenUsage?: CodexTokenUsageNotification["tokenUsage"];
  startedAt?: number;
  completedAt?: number;
}

export function getCodexRequestRecordId(turnId: string): string {
  return `codex-turn-${turnId}`;
}

export function hasCodexRequestRecord(
  requestLog: UpstreamRequestRecord[] | undefined,
  turnId: string,
): boolean {
  const id = getCodexRequestRecordId(turnId);
  return (requestLog ?? []).some((record) => record.id === id);
}

export function upsertCodexRequestRecord(
  requestLog: UpstreamRequestRecord[] | undefined,
  update: CodexRequestUpdate,
): UpstreamRequestRecord[] {
  const next = [...(requestLog ?? [])];
  const id = getCodexRequestRecordId(update.turnId);
  const existingIndex = next.findIndex((record) => record.id === id);
  const existing = existingIndex >= 0 ? next[existingIndex] : undefined;
  const tokenUsage = update.tokenUsage?.last;
  const record: UpstreamRequestRecord = {
    ...existing,
    id,
    engine: "codex",
    status: update.status ?? existing?.status ?? (tokenUsage ? "completed" : "pending"),
    startedAt: existing?.startedAt ?? update.startedAt ?? Date.now(),
    requestCount: 1,
    note: "codex_cost_unavailable",
    ...(update.model ? { model: update.model } : {}),
    ...(update.completedAt ? { completedAt: update.completedAt } : {}),
    ...(tokenUsage
      ? {
          status: update.status ?? "completed",
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          cacheReadTokens: tokenUsage.cachedInputTokens,
          cacheCreationTokens: 0,
          reasoningOutputTokens: tokenUsage.reasoningOutputTokens,
        }
      : {}),
  };

  if (existingIndex >= 0) {
    next[existingIndex] = record;
  } else {
    next.push(record);
  }
  return trimUpstreamRequestLog(next);
}
