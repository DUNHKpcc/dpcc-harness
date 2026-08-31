import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "@/types";
import { ChatUiStateProvider } from "../chat-ui-state";
import { ToolCall } from "../ToolCall";
import { BashContent } from "../tool-renderers/BashContent";

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

  it("keeps a Pi Bash tool running while showing its recovered command", () => {
    const message: UIMessage = {
      id: "tool-bash",
      role: "tool_call",
      content: "",
      toolName: "Bash",
      toolInput: { command: "pnpm test" },
      toolResult: { stdout: "partial output\n", status: "in_progress" },
      timestamp: 0,
    };

    const markup = renderToStaticMarkup(
      <ChatUiStateProvider>
        <ToolCall message={message} disableCollapseAnimation />
      </ChatUiStateProvider>,
    );

    expect(markup).toContain("Running");
    expect(markup).toContain("pnpm test");
    expect(markup).not.toContain(">Ran<");
  });

  it("renders recovered Pi terminal output in the expanded Bash details", () => {
    const message: UIMessage = {
      id: "tool-bash-complete",
      role: "tool_call",
      content: "",
      toolName: "Bash",
      toolInput: { command: "printf 'alpha\\nbeta\\n'" },
      toolResult: { stdout: "alpha\nbeta\n", exitCode: 0, status: "completed" },
      timestamp: 0,
    };

    const markup = renderToStaticMarkup(
      <ChatUiStateProvider>
        <BashContent message={message} />
      </ChatUiStateProvider>,
    );

    expect(markup).toContain("printf");
    expect(markup).toContain("alpha");
    expect(markup).toContain("beta");
  });
});
