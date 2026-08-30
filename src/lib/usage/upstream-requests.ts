import type { UpstreamRequestRecord } from "@/types";

export const RECENT_UPSTREAM_REQUEST_LIMIT = 10;

export function getUpstreamRequestTokenTotal(
  record: UpstreamRequestRecord,
): number | undefined {
  const tokenParts = [
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheCreationTokens,
  ];
  return tokenParts.some((value) => value != null)
    ? tokenParts.reduce<number>((total, value) => total + (value ?? 0), 0)
    : undefined;
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

export function upsertUpstreamRequestRecord(
  requestLog: UpstreamRequestRecord[] | undefined,
  record: UpstreamRequestRecord,
): { requestLog: UpstreamRequestRecord[]; inserted: boolean } {
  const next = [...(requestLog ?? [])];
  const index = next.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...record };
  } else {
    next.push(record);
  }
  return { requestLog: trimUpstreamRequestLog(next), inserted: index < 0 };
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
