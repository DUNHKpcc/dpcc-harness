import { describe, expect, it, vi } from "vitest";
import installPccContextUsage from "../../../build/pi-runtime/extensions/pcc-context-usage";
import {
  parsePiContextBridgeMessage,
  PI_CONTEXT_BRIDGE_PREFIX,
} from "../pi-context-bridge";

type ExtensionHandler = (event: unknown, context: unknown) => void | Promise<void>;

describe("PccAgent Pi context extension", () => {
  it("emits read-only context snapshots through the Pi UI bridge", async () => {
    const handlers = new Map<string, ExtensionHandler>();
    const api = {
      on: vi.fn((event: string, handler: ExtensionHandler) => {
        handlers.set(event, handler);
      }),
      getAllTools: () => [{ name: "read", description: "Read a project file" }],
      getActiveTools: () => ["read"],
    };
    const notify = vi.fn();
    const getContextUsage = vi.fn(() => ({ tokens: 3_200, contextWindow: 128_000 }));
    const context = {
      model: { provider: "pcc-agent", id: "gpt-5.6", contextWindow: 128_000, maxTokens: 8_192 },
      getContextUsage,
      getSystemPrompt: () => "system secret that must not be forwarded",
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            id: "user-1",
            parentId: null,
            timestamp: "2026-09-02T02:00:00.000Z",
            message: { role: "user", content: "Inspect the current context." },
          },
          {
            type: "message",
            id: "assistant-1",
            parentId: "user-1",
            timestamp: "2026-09-02T02:00:01.000Z",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "The context details are ready." },
                { type: "thinking", thinking: "private reasoning that must not be forwarded" },
              ],
            },
          },
          {
            type: "message",
            id: "tool-1",
            parentId: "assistant-1",
            timestamp: "2026-09-02T02:00:02.000Z",
            message: {
              role: "toolResult",
              toolName: "bash",
              content: "sensitive tool output that must not be forwarded",
            },
          },
          {
            type: "compaction",
            id: "compaction-1",
            parentId: "tool-1",
            timestamp: "2026-09-02T02:00:03.000Z",
            summary: "Kept the project decisions.",
          },
        ],
      },
      ui: { notify },
    };

    installPccContextUsage(api);
    expect(api.on).toHaveBeenCalledTimes(5);

    await handlers.get("agent_settled")?.({}, context);
    const marker = String(notify.mock.calls.at(-1)?.[0] ?? "");
    const snapshot = parsePiContextBridgeMessage(marker);

    expect(marker).toMatch(new RegExp(`^${PI_CONTEXT_BRIDGE_PREFIX}`));
    expect(marker).not.toContain("system secret");
    expect(marker).not.toContain("private reasoning");
    expect(marker).not.toContain("sensitive tool output");
    expect(snapshot).toMatchObject({
      source: "pi-extension",
      phase: "settled",
      model: "pcc-agent/gpt-5.6",
      usedTokens: 3_200,
      contextWindow: 128_000,
    });
    expect(snapshot?.breakdown.systemPromptTokens).toBeGreaterThan(0);
    expect(snapshot?.details).toMatchObject({
      systemPrompt: {
        characterCount: "system secret that must not be forwarded".length,
      },
      tools: [{ name: "read", description: "Read a project file" }],
      timeline: [
        { kind: "user", excerpt: "Inspect the current context." },
        { kind: "assistant", excerpt: "The context details are ready." },
        { kind: "tool", label: "Tool: bash", excerpt: null },
        { kind: "compaction", excerpt: "Kept the project decisions." },
      ],
    });
    expect(notify).toHaveBeenLastCalledWith(expect.any(String), "info");
  });

  it("keeps post-compaction usage unknown without changing Pi state", async () => {
    const handlers = new Map<string, ExtensionHandler>();
    const api = {
      on: vi.fn((event: string, handler: ExtensionHandler) => {
        handlers.set(event, handler);
      }),
      getAllTools: () => [],
      getActiveTools: () => [],
    };
    const notify = vi.fn();
    const getContextUsage = vi.fn(() => ({ tokens: 120_000, contextWindow: 128_000 }));
    const context = {
      model: { provider: "pcc-agent", id: "gpt-5.6", contextWindow: 128_000, maxTokens: 8_192 },
      getContextUsage,
      getSystemPrompt: () => "",
      ui: { notify },
    };

    installPccContextUsage(api);
    await handlers.get("session_compact")?.({
      reason: "manual",
      compactionEntry: {
        tokensBefore: 120_000,
        summary: "Kept the implementation decisions and next steps.",
      },
    }, context);

    const snapshot = parsePiContextBridgeMessage(String(notify.mock.calls.at(-1)?.[0] ?? ""));
    expect(getContextUsage).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      phase: "compacted",
      usedTokens: null,
      compaction: {
        reason: "manual",
        tokensBefore: 120_000,
        summary: "Kept the implementation decisions and next steps.",
      },
    });
  });

  it("keeps rich details below the renderer bridge limit", async () => {
    const handlers = new Map<string, ExtensionHandler>();
    const tools = Array.from({ length: 30 }, (_, index) => ({
      name: `tool-${index}`,
      description: `Tool description ${index}: ${"x".repeat(320)}`,
    }));
    const api = {
      on: vi.fn((event: string, handler: ExtensionHandler) => {
        handlers.set(event, handler);
      }),
      getAllTools: () => tools,
      getActiveTools: () => tools.map((tool) => tool.name),
    };
    const notify = vi.fn();
    const context = {
      model: { provider: "pcc-agent", id: "gpt-5.6", contextWindow: 128_000, maxTokens: 8_192 },
      getContextUsage: () => ({ tokens: 16_000, contextWindow: 128_000 }),
      getSystemPrompt: () => "system prompt ".repeat(1_000),
      sessionManager: {
        getBranch: () => Array.from({ length: 80 }, (_, index) => ({
          type: "message",
          id: `message-${index}`,
          parentId: index === 0 ? null : `message-${index - 1}`,
          timestamp: 1_700_000_000_000 + index,
          message: {
            role: "user",
            content: `Visible message ${index}: ${"y".repeat(1_200)}`,
          },
        })),
      },
      ui: { notify },
    };

    installPccContextUsage(api);
    await handlers.get("agent_settled")?.({}, context);

    const marker = String(notify.mock.calls.at(-1)?.[0] ?? "");
    const snapshot = parsePiContextBridgeMessage(marker);
    expect(marker.length).toBeLessThan(24_000);
    expect(snapshot?.details).toMatchObject({
      totalTools: 30,
      omittedTools: expect.any(Number),
      totalEntries: 80,
      omittedEntries: expect.any(Number),
    });
    expect(snapshot?.details?.timeline.length).toBeLessThanOrEqual(40);
    expect(snapshot?.details?.omittedEntries).toBeGreaterThanOrEqual(40);
  });
});
