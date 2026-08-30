import { describe, expect, it } from "vitest";
import {
  appendUpstreamRequestRecord,
  getUpstreamRequestCount,
  getUpstreamRequestTokenTotal,
  RECENT_UPSTREAM_REQUEST_LIMIT,
  upsertUpstreamRequestRecord,
} from "../upstream-requests";
import type { UpstreamRequestRecord } from "@/types";

function createRecord(index: number): UpstreamRequestRecord {
  return {
    id: `request-${index}`,
    engine: "acp",
    model: "pi/default",
    status: "completed",
    startedAt: index,
    completedAt: index + 1,
    requestCount: 1,
  };
}

describe("upstream request helpers", () => {
  it("keeps only the most recent detailed request records", () => {
    const records = Array.from(
      { length: RECENT_UPSTREAM_REQUEST_LIMIT + 3 },
      (_, index) => createRecord(index + 1),
    ).reduce<UpstreamRequestRecord[]>(
      (log, record) => appendUpstreamRequestRecord(log, record),
      [],
    );

    expect(records).toHaveLength(RECENT_UPSTREAM_REQUEST_LIMIT);
    expect(records[0].id).toBe("request-4");
    expect(records.at(-1)?.id).toBe("request-13");
  });

  it("prefers the persisted total count over the truncated detailed log", () => {
    const records = [createRecord(11), createRecord(12), createRecord(13)];

    expect(getUpstreamRequestCount(records, 13)).toBe(13);
    expect(getUpstreamRequestCount(records)).toBe(3);
  });

  it("updates a pending utility request without inserting a second request", () => {
    const pending = { ...createRecord(1), status: "pending" as const };
    const initial = upsertUpstreamRequestRecord([], pending);
    const completed = upsertUpstreamRequestRecord(initial.requestLog, {
      ...pending,
      status: "completed",
      completedAt: 10,
    });

    expect(initial.inserted).toBe(true);
    expect(completed.inserted).toBe(false);
    expect(completed.requestLog).toEqual([
      expect.objectContaining({ id: pending.id, status: "completed", completedAt: 10 }),
    ]);
  });

  it("returns unavailable usage distinctly and avoids double-counting reasoning tokens", () => {
    expect(getUpstreamRequestTokenTotal(createRecord(1))).toBeUndefined();
    expect(getUpstreamRequestTokenTotal({
      ...createRecord(2),
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      reasoningOutputTokens: 7,
    })).toBe(135);
  });
});
