import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  capturePiAcpTurnSnapshot,
  parsePiAcpTurnUsage,
  readPiAcpTurnUsage,
} from "./pi-acp-turn-usage";
import { startUtilityRequest, type UtilityRequestEvent } from "./upstream-request-tracker";

function jsonLine(value: unknown): string {
  return JSON.stringify(value);
}

describe("startUtilityRequest", () => {
  it("records a successful request with usage and ignores repeated finish calls", () => {
    const events: UtilityRequestEvent[] = [];
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145);
    const finish = startUtilityRequest(
      (event) => events.push(event),
      "session-1",
      "acp",
      "prompt",
      { id: "utility-1", turnId: "turn-1", model: "configured-model", now },
    );

    finish?.(true, {
      model: "actual-provider/actual-model",
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheCreationTokens: 2,
      reasoningOutputTokens: 3,
      costUSD: 0.25,
    });
    finish?.(false, undefined, { code: "late_failure", message: "ignored" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      _sessionId: "session-1",
      countDelta: 1,
      record: {
        id: "utility-1",
        turnId: "turn-1",
        model: "configured-model",
        status: "pending",
        requestCount: 1,
        note: "utility_prompt",
      },
    });
    expect(events[1]).toMatchObject({
      countDelta: 0,
      record: {
        id: "utility-1",
        status: "completed",
        completedAt: 145,
        durationMs: 45,
        model: "actual-provider/actual-model",
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheCreationTokens: 2,
        reasoningOutputTokens: 3,
        costUSD: 0.25,
      },
    });
  });

  it("records failure metadata and ignores a repeated finish", () => {
    const events: UtilityRequestEvent[] = [];
    const now = vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(5);
    const finish = startUtilityRequest(
      (event) => events.push(event),
      "session-1",
      "acp",
      "title",
      { id: "utility-2", now },
    );

    finish?.(false, undefined, { code: "pi_retry_exhausted", message: "upstream unavailable" });
    finish?.(false, undefined, { code: "second_failure", message: "ignored" });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      record: {
        id: "utility-2",
        status: "failed",
        completedAt: 5,
        durationMs: 0,
        errorCode: "pi_retry_exhausted",
        errorMessage: "upstream unavailable",
        note: "utility_title:pi_retry_exhausted",
      },
    });
  });

  it("records cancellation as a distinct terminal status", () => {
    const events: UtilityRequestEvent[] = [];
    const finish = startUtilityRequest(
      (event) => events.push(event),
      "session-1",
      "acp",
      "prompt",
      { id: "utility-cancel" },
    );

    finish?.(false, undefined, {
      code: "acp_cancelled",
      message: "ACP turn cancelled.",
      status: "cancelled",
    });

    expect(events.at(-1)?.record).toMatchObject({
      status: "cancelled",
      errorCode: "acp_cancelled",
      errorMessage: "ACP turn cancelled.",
    });
  });
});

describe("Pi ACP turn usage", () => {
  it("aggregates only eligible assistant usage and reports the actual provider/model", () => {
    const startedAt = Date.parse("2026-08-29T12:00:00.000Z");
    const usage = parsePiAcpTurnUsage([
      jsonLine({
        type: "message",
        timestamp: "2026-08-29T11:59:59.000Z",
        message: {
          role: "assistant",
          provider: "old-provider",
          model: "old-model",
          usage: { input: 999, output: 999, cacheRead: 999, cacheWrite: 999 },
        },
      }),
      jsonLine({
        type: "model_change",
        timestamp: "2026-08-29T12:00:00.010Z",
        provider: "pcc-agent-dpcc-codex",
        modelId: "gpt-5.6-luna",
      }),
      jsonLine({
        type: "message",
        timestamp: "2026-08-29T12:00:00.020Z",
        message: {
          role: "assistant",
          provider: "pcc-agent-dpcc-codex",
          model: "gpt-5.6-luna",
          usage: {
            input: 15,
            output: 7,
            cacheRead: 3,
            cacheWrite: 2,
            reasoning: 4,
            cost: { total: 0.25 },
          },
        },
      }),
      "{malformed",
      jsonLine({
        type: "message",
        timestamp: "2026-08-29T12:00:00.030Z",
        message: {
          role: "assistant",
          provider: "pcc-agent-dpcc-codex",
          model: "gpt-5.6-luna",
          usage: {
            input: 5,
            output: 2,
            cacheRead: 1,
            cacheWrite: 0,
            reasoning: 1,
            cost: { total: 0.5 },
          },
        },
      }),
    ].join("\n"), startedAt);

    expect(usage).toEqual({
      model: "pcc-agent-dpcc-codex/gpt-5.6-luna",
      inputTokens: 20,
      outputTokens: 9,
      cacheReadTokens: 4,
      cacheCreationTokens: 2,
      reasoningOutputTokens: 5,
      costUSD: 0.75,
    });
  });

  it("reads only JSONL records appended after the prompt snapshot", async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harnss-pi-usage-"));
    try {
      const sessionId = "pi-session-1";
      const sessionFile = path.join(tempDir, "session.jsonl");
      const sessionMapPath = path.join(tempDir, "session-map.json");
      await fs.promises.writeFile(sessionFile, `${jsonLine({
        type: "message",
        timestamp: "2026-08-29T11:59:59.000Z",
        message: {
          role: "assistant",
          provider: "old-provider",
          model: "old-model",
          usage: { input: 999, output: 999 },
        },
      })}\n`, "utf8");
      await fs.promises.writeFile(sessionMapPath, JSON.stringify({
        version: 1,
        sessions: {
          [sessionId]: { sessionId, cwd: tempDir, sessionFile },
        },
      }), "utf8");

      const snapshot = await capturePiAcpTurnSnapshot(sessionId, {
        sessionMapPath,
        now: () => Date.parse("2026-08-29T12:00:00.000Z"),
      });
      await fs.promises.appendFile(sessionFile, `${jsonLine({
        type: "message",
        timestamp: "2026-08-29T12:00:00.100Z",
        message: {
          role: "assistant",
          provider: "pcc-agent-dpcc-codex",
          model: "gpt-5.6-luna",
          usage: {
            input: 25,
            output: 6,
            cacheRead: 10,
            cacheWrite: 0,
            reasoning: 2,
            cost: { total: 0 },
          },
        },
      })}\n`, "utf8");

      await expect(readPiAcpTurnUsage(snapshot)).resolves.toEqual({
        model: "pcc-agent-dpcc-codex/gpt-5.6-luna",
        inputTokens: 25,
        outputTokens: 6,
        cacheReadTokens: 10,
        cacheCreationTokens: 0,
        reasoningOutputTokens: 2,
        costUSD: 0,
      });
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
