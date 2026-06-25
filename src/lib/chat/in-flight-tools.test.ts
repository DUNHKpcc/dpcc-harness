import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { markInFlightToolCallsFailed } from "./in-flight-tools";

describe("markInFlightToolCallsFailed", () => {
  it("marks running Task/Agent tool calls as failed", () => {
    const messages: UIMessage[] = [
      {
        id: "tool-1",
        role: "tool_call",
        content: "",
        toolName: "Agent",
        timestamp: 0,
        subagentStatus: "running",
        subagentSteps: [{ toolName: "Bash", toolInput: {}, toolUseId: "bash-1" }],
      },
    ];

    expect(markInFlightToolCallsFailed(messages, "Process exited")).toEqual([
      {
        ...messages[0],
        toolError: true,
        toolResult: { type: "text", content: "Process exited", status: "failed" },
        subagentStatus: "failed",
      },
    ]);
  });

  it("marks ordinary unfinished tool calls as failed", () => {
    const messages: UIMessage[] = [
      {
        id: "codex-tool-1",
        role: "tool_call",
        content: "",
        toolName: "Bash",
        timestamp: 0,
      },
    ];

    expect(markInFlightToolCallsFailed(messages, "Turn failed")).toEqual([
      {
        ...messages[0],
        toolError: true,
        toolResult: { type: "text", content: "Turn failed", status: "failed" },
      },
    ]);
  });

  it("leaves completed tools unchanged and preserves array identity", () => {
    const messages: UIMessage[] = [
      {
        id: "tool-1",
        role: "tool_call",
        content: "",
        toolName: "Read",
        timestamp: 0,
        toolResult: { content: "ok" },
      },
    ];

    expect(markInFlightToolCallsFailed(messages, "ignored")).toBe(messages);
  });
});
