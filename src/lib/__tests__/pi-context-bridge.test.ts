import { describe, expect, it } from "vitest";
import {
  appendPiContextSnapshot,
  contextUsageFromPiSnapshot,
  createLegacyPiContextSnapshot,
  MAX_PI_CONTEXT_SNAPSHOTS,
  parsePiContextBridgeMessage,
  parsePiContextSnapshot,
  PI_CONTEXT_BRIDGE_PREFIX,
  piContextSummaryMessage,
} from "../pi-context-bridge";

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: "snapshot-1",
    capturedAt: 1_700_000_000_000,
    phase: "settled",
    model: "pcc-agent/gpt-5.6",
    usedTokens: 3_200,
    contextWindow: 128_000,
    breakdown: {
      systemPromptTokens: 500,
      toolTokens: 400,
      conversationTokens: 2_300,
      reservedOutputTokens: 2_000,
      freeTokens: 122_800,
    },
    ...overrides,
  };
}

describe("Pi context bridge", () => {
  it("accepts bounded Pi composition metadata", () => {
    const snapshot = parsePiContextBridgeMessage(
      `${PI_CONTEXT_BRIDGE_PREFIX}${JSON.stringify(payload({
        details: {
          systemPrompt: { characterCount: 2_000, tokenEstimate: 500 },
          tools: [{ name: "read", description: "Read a project file", tokenEstimate: 90 }],
          totalTools: 1,
          omittedTools: 0,
          timeline: [{
            id: "message-1",
            kind: "user",
            label: null,
            timestamp: 1_700_000_000_000,
            tokenEstimate: 24,
            characterCount: 96,
            excerpt: "Inspect the current context.",
            excerptTruncated: false,
          }],
          totalEntries: 1,
          omittedEntries: 0,
        },
      }))}`,
    );

    expect(snapshot).toMatchObject({
      id: "snapshot-1",
      source: "pi-extension",
      usedTokens: 3_200,
      contextWindow: 128_000,
      breakdown: {
        systemPromptTokens: 500,
        toolTokens: 400,
        conversationTokens: 2_300,
      },
    });
    expect(snapshot?.percent).toBe(2.5);
    expect(snapshot?.details).toMatchObject({
      systemPrompt: { characterCount: 2_000, tokenEstimate: 500 },
      tools: [{ name: "read", tokenEstimate: 90 }],
      timeline: [{ kind: "user", excerpt: "Inspect the current context." }],
    });
  });

  it("rejects malformed bridge data rather than rendering it as context state", () => {
    expect(parsePiContextBridgeMessage(`${PI_CONTEXT_BRIDGE_PREFIX}{oops`)).toBeNull();
    expect(parsePiContextSnapshot(payload({ version: 2 }))).toBeNull();
    expect(parsePiContextSnapshot(payload({ usedTokens: -1 }))).toBeNull();
    expect(parsePiContextSnapshot(payload({ phase: "not-a-phase" }))).toBeNull();
    expect(parsePiContextSnapshot(payload({
      details: { systemPrompt: { characterCount: "not-a-number", tokenEstimate: 10 } },
    }))?.details).toBeUndefined();
  });

  it("bounds history and replaces a duplicate snapshot id", () => {
    let snapshots = [] as NonNullable<ReturnType<typeof parsePiContextSnapshot>>[];
    for (let index = 0; index < MAX_PI_CONTEXT_SNAPSHOTS + 2; index += 1) {
      const snapshot = parsePiContextSnapshot(payload({
        id: `snapshot-${index}`,
        capturedAt: 1_700_000_000_000 + index,
      }));
      if (!snapshot) throw new Error("fixture snapshot did not parse");
      snapshots = appendPiContextSnapshot(snapshots, snapshot);
    }

    expect(snapshots).toHaveLength(MAX_PI_CONTEXT_SNAPSHOTS);
    expect(snapshots[0]?.id).toBe("snapshot-2");

    const replacement = parsePiContextSnapshot(payload({
      id: "snapshot-2",
      usedTokens: 4_000,
    }));
    if (!replacement) throw new Error("replacement snapshot did not parse");
    snapshots = appendPiContextSnapshot(snapshots, replacement);
    expect(snapshots).toHaveLength(MAX_PI_CONTEXT_SNAPSHOTS);
    expect(snapshots[0]).toMatchObject({ id: "snapshot-2", usedTokens: 4_000 });
  });

  it("keeps post-compaction usage unknown while retaining the compaction summary", () => {
    const snapshot = parsePiContextSnapshot(payload({
      phase: "compacted",
      usedTokens: null,
      compaction: {
        reason: "manual",
        tokensBefore: 120_000,
        summary: "Kept the implementation decisions and next steps.",
      },
    }));
    if (!snapshot) throw new Error("compacted snapshot did not parse");

    expect(contextUsageFromPiSnapshot(snapshot)).toMatchObject({
      inputTokens: 0,
      contextWindow: 128_000,
    });
    expect(piContextSummaryMessage(snapshot)).toMatchObject({
      role: "summary",
      content: "Kept the implementation decisions and next steps.",
      compactTrigger: "manual",
      compactPreTokens: 120_000,
    });
  });

  it("persists details for only the newest detailed snapshot", () => {
    const first = parsePiContextSnapshot(payload({
      id: "first",
      details: {
        systemPrompt: { characterCount: 100, tokenEstimate: 25 },
        tools: [],
        totalTools: 0,
        omittedTools: 0,
        timeline: [],
        totalEntries: 0,
        omittedEntries: 0,
      },
    }));
    const second = parsePiContextSnapshot(payload({
      id: "second",
      details: {
        systemPrompt: { characterCount: 200, tokenEstimate: 50 },
        tools: [],
        totalTools: 0,
        omittedTools: 0,
        timeline: [],
        totalEntries: 0,
        omittedEntries: 0,
      },
    }));
    if (!first || !second) throw new Error("detail fixtures did not parse");

    let snapshots = appendPiContextSnapshot([first], second);
    expect(snapshots[0]?.details).toBeUndefined();
    expect(snapshots[1]?.details?.systemPrompt.tokenEstimate).toBe(50);

    const retry = parsePiContextSnapshot(payload({ id: "second", usedTokens: 4_000 }));
    if (!retry) throw new Error("retry fixture did not parse");
    snapshots = appendPiContextSnapshot(snapshots, retry);
    expect(snapshots[1]?.details?.systemPrompt.tokenEstimate).toBe(50);
  });

  it("falls back to the legacy ACP meter before Pi emits its first snapshot", () => {
    const snapshot = createLegacyPiContextSnapshot({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheCreationTokens: 300,
      contextWindow: 100_000,
    }, 1);

    expect(snapshot).toMatchObject({
      source: "legacy",
      usedTokens: 3_300,
      contextWindow: 100_000,
      capturedAt: 1,
    });
  });
});
