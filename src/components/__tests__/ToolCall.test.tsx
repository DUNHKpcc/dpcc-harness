import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "@/types";
import { ChatUiStateProvider } from "../chat-ui-state";
import { ToolCall } from "../ToolCall";

describe("ToolCall", () => {
  it("renders presented plans expanded and full by default", () => {
    const plan = `# Implementation Plan

${Array.from({ length: 220 }, (_, index) => `- Step ${index + 1}`).join("\n")}`;
    const message: UIMessage = {
      id: "plan-1",
      role: "tool_call",
      content: "",
      toolName: "ExitPlanMode",
      toolInput: {
        plan,
        filePath: "/repo/.codex/plan.md",
      },
      toolResult: {
        content: "Plan: 220 steps",
      },
      timestamp: 0,
    };

    const markup = renderToStaticMarkup(
      <ChatUiStateProvider>
        <ToolCall message={message} disableCollapseAnimation />
      </ChatUiStateProvider>,
    );

    expect(markup).toContain("Presented plan");
    expect(markup).toContain("Step 220");
    expect(markup).not.toContain("Show full plan");
  });

  it("renders failed agent tools without a running shimmer label", () => {
    const message: UIMessage = {
      id: "tool-agent",
      role: "tool_call",
      content: "",
      toolName: "Agent",
      toolInput: { description: "Explore project" },
      toolResult: { content: "Process exited with code 143" },
      toolError: true,
      subagentStatus: "failed",
      subagentSteps: [{ toolName: "Bash", toolInput: {}, toolUseId: "bash-1" }],
      timestamp: 0,
    };

    const markup = renderToStaticMarkup(
      <ChatUiStateProvider>
        <ToolCall message={message} disableCollapseAnimation />
      </ChatUiStateProvider>,
    );

    expect(markup).toContain("Agent stopped");
    expect(markup).not.toContain("Running agent");
  });
});
