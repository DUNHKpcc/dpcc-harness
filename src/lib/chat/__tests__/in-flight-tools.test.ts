import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import {
  finalizeInterruptedMessages,
  markInFlightToolCallsFailed,
} from "../in-flight-tools";

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

describe("finalizeInterruptedMessages", () => {
  it("clears persisted runtime progress after an interrupted app exit", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-stream",
        role: "assistant",
        content: "partial output",
        thinking: "partial thought",
        timestamp: 1,
        isStreaming: true,
      },
      {
        id: "tool-bash",
        role: "tool_call",
        content: "",
        toolName: "Bash",
        timestamp: 2,
      },
      {
        id: "tool-task",
        role: "tool_call",
        content: "",
        toolName: "Task",
        timestamp: 3,
        subagentStatus: "running",
      },
      {
        id: "queued-user",
        role: "user",
        content: "not sent",
        timestamp: 4,
        isQueued: true,
      },
      {
        id: "todo-plan",
        role: "tool_call",
        content: "",
        toolName: "TodoWrite",
        toolInput: {
          todos: [
            { content: "finished", status: "completed" },
            { content: "interrupted", status: "in_progress" },
          ],
        },
        toolResult: { content: "Plan: 2 steps" },
        timestamp: 5,
      },
    ];

    const result = finalizeInterruptedMessages(messages, "Interrupted by exit.");

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      isStreaming: false,
      thinkingComplete: true,
    });
    expect(result[1]).toMatchObject({
      toolError: true,
      toolResult: { status: "failed", content: "Interrupted by exit." },
    });
    expect(result[2]).toMatchObject({
      toolError: true,
      subagentStatus: "failed",
      toolResult: { status: "failed", content: "Interrupted by exit." },
    });
    expect(result[3].toolInput?.todos).toEqual([
      { content: "finished", status: "completed" },
      { content: "interrupted", status: "pending" },
    ]);
  });

  it("preserves the original array when no runtime progress remains", () => {
    const messages: UIMessage[] = [{
      id: "done",
      role: "assistant",
      content: "done",
      timestamp: 1,
    }];

    expect(finalizeInterruptedMessages(messages)).toBe(messages);
  });
});
