import { describe, expect, it } from "vitest";
import {
  isClaudeModelCacheRequestCurrent,
  isClaudeModelRequestCurrent,
} from "../claude-model-request";

describe("isClaudeModelRequestCurrent", () => {
  it("accepts the same session and generation", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-a", generation: 2 },
    )).toBe(true);
  });

  it("rejects a request captured for a different session", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-b", generation: 2 },
    )).toBe(false);
  });

  it("rejects a request superseded by a newer generation", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-a", generation: 3 },
    )).toBe(false);
  });
});

describe("isClaudeModelCacheRequestCurrent", () => {
  it("accepts an exact cache generation match", () => {
    expect(isClaudeModelCacheRequestCurrent(4, 4)).toBe(true);
  });

  it("rejects an older cache generation", () => {
    expect(isClaudeModelCacheRequestCurrent(4, 5)).toBe(false);
  });
});
