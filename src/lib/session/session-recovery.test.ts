import { describe, expect, it } from "vitest";
import {
  APP_RESTART_INTERRUPTED_CODE,
  normalizeInterruptedSession,
} from "@shared/lib/session-recovery";

describe("normalizeInterruptedSession", () => {
  it("finalizes an interrupted tool, request, and processing flag together", () => {
    const session = {
      messages: [
        {
          id: "tool-1",
          role: "tool_call",
          content: "running",
          timestamp: 1,
          isStreaming: true,
        },
      ],
      requestLog: [
        {
          id: "request-1",
          turnId: "turn-1",
          engine: "acp",
          status: "pending",
          startedAt: 100,
          requestCount: 1,
        },
      ],
      isProcessing: true,
    };

    const recovered = normalizeInterruptedSession(session, "interrupted", 250);

    expect(recovered).not.toBe(session);
    expect(recovered.isProcessing).toBe(false);
    expect(recovered.messages[0]).toMatchObject({
      toolError: true,
      isStreaming: false,
      toolResult: { status: "failed", content: "interrupted" },
    });
    expect(recovered.requestLog[0]).toMatchObject({
      turnId: "turn-1",
      status: "failed",
      completedAt: 250,
      durationMs: 150,
      errorCode: APP_RESTART_INTERRUPTED_CODE,
      errorMessage: "interrupted",
    });
    expect(session.messages[0]).not.toHaveProperty("toolError");
    expect(session.requestLog[0].status).toBe("pending");
  });

  it("keeps an already terminal session referentially stable", () => {
    const session = {
      messages: [{ id: "assistant-1", role: "assistant", content: "done", timestamp: 1 }],
      requestLog: [{ id: "request-1", status: "completed", startedAt: 1, completedAt: 2 }],
      isProcessing: false,
    };

    expect(normalizeInterruptedSession(session, "interrupted", 250)).toBe(session);
  });
});
