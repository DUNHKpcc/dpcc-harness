import { describe, expect, it } from "vitest";
import {
  classifyAcpTurn,
  createAcpTurnObservation,
  isPiRetryNotice,
  isPiStartupBanner,
  observeAcpTurnUpdate,
} from "@shared/lib/acp-turn";

describe("ACP turn outcome", () => {
  it("recognizes adapter retry notices as diagnostics", () => {
    const observation = createAcpTurnObservation();
    expect(observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Retrying (attempt 3/3, waiting 8s)..." },
    }, { isPi: true, adapterVersion: "0.0.33" })).toEqual({ diagnostic: true });
    expect(isPiRetryNotice("Retry finished, resuming.")).toBe(true);
    expect(observation.retryNoticeCount).toBe(1);
  });

  it("recognizes the adapter retry-start chunk without treating it as answer text", () => {
    const observation = createAcpTurnObservation();
    expect(observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Retrying..." },
    }, { isPi: true, adapterVersion: "0.0.33" })).toEqual({ diagnostic: true });
    expect(observation.retryNoticeCount).toBe(1);
    expect(observation.meaningfulTextLength).toBe(0);
  });

  it("keeps the asynchronous Pi startup banner out of assistant content", () => {
    const observation = createAcpTurnObservation();
    const banner = "pi v0.84.1\n---\n";

    expect(isPiStartupBanner(banner)).toBe(true);
    expect(observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: banner },
    }, { isPi: true, adapterVersion: "0.0.33" })).toEqual({ diagnostic: true });
    expect(observation.meaningfulTextLength).toBe(0);
    expect(isPiStartupBanner("Pi completed the requested work.")).toBe(false);
  });

  it("turns retry exhaustion hidden behind end_turn into a failure", () => {
    const outcome = classifyAcpTurn({
      stopReason: "end_turn",
      isPi: true,
      adapterVersion: "0.0.33",
      observation: { retryNoticeCount: 4 },
      stderrError: "Connection error.",
    });

    expect(outcome).toEqual({
      status: "failed",
      error: {
        code: "pi_retry_exhausted",
        message: "Connection error.",
        source: "upstream",
        stage: "prompt",
        retryable: true,
      },
    });
  });

  it("does not classify a normal response as an error", () => {
    const observation = createAcpTurnObservation();
    observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Done." },
    }, { isPi: true, adapterVersion: "0.0.33" });
    expect(classifyAcpTurn({ stopReason: "end_turn", isPi: true, adapterVersion: "0.0.33", observation })).toEqual({
      status: "completed",
      stopReason: "end_turn",
    });
  });

  it("keeps cancellation distinct from failure", () => {
    expect(classifyAcpTurn({ stopReason: "cancelled", isPi: true, adapterVersion: "0.0.33" })).toEqual({
      status: "cancelled",
      stopReason: "cancelled",
    });
  });

  it("rejects an invalid adapter stop reason", () => {
    const outcome = classifyAcpTurn({ stopReason: "error", isPi: true, adapterVersion: "0.0.33" });
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("acp_invalid_stop_reason");
  });

  it("fails closed when the official adapter version is unknown", () => {
    const outcome = classifyAcpTurn({
      stopReason: "end_turn",
      isPi: true,
      adapterVersion: "0.0.34",
      observation: { meaningfulTextLength: 12 },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("pi_adapter_version_unsupported");
  });

  it("does not treat ordinary model text containing retry as a Pi diagnostic", () => {
    const observation = createAcpTurnObservation();
    expect(observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "I will retry that operation now." },
    }, { isPi: true, adapterVersion: "0.0.33" })).toEqual({ diagnostic: false });
    expect(observation.retryNoticeCount).toBe(0);
    expect(observation.meaningfulTextLength).toBeGreaterThan(0);
  });

  it("accepts structured retry metadata and does not double count its text mirror", () => {
    const observation = createAcpTurnObservation();
    observeAcpTurnUpdate(observation, {
      sessionUpdate: "agent_message_chunk",
      _meta: { retry: true },
      content: { type: "text", text: "Retrying (attempt 1/3, waiting 2s)..." },
    }, { isPi: true, adapterVersion: "0.0.33" });
    expect(observation.retryNoticeCount).toBe(1);
  });
});
