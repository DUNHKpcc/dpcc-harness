import { describe, expect, it } from "vitest";
import {
  appendUpstreamRequestRecord,
  getUpstreamRequestCount,
  RECENT_UPSTREAM_REQUEST_LIMIT,
} from "../upstream-requests";
import type { UpstreamRequestRecord } from "@/types";

function createRecord(index: number): UpstreamRequestRecord {
  return {
    id: `request-${index}`,
    engine: "claude",
    model: "claude-sonnet-4-5",
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
});
