import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { UPSTREAM_REQUEST_SCROLL_AREA_CLASS } from "@/components/lib/chat-header-layout";
import { ChatHeader } from "../ChatHeader";

type ChatHeaderProps = ComponentProps<typeof ChatHeader>;

function createProps(overrides: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
  return {
    islandLayout: false,
    sidebarOpen: true,
    isProcessing: false,
    model: "gpt-5.1",
    sessionId: "session-1",
    totalCost: 0,
    planMode: false,
    permissionMode: "default",
    onToggleSidebar: vi.fn(),
    ...overrides,
  };
}

describe("ChatHeader", () => {
  it("shows the aggregated upstream request count on the details trigger", () => {
    const markup = renderToStaticMarkup(
      <ChatHeader
        {...createProps({
          requestLog: [
            {
              id: "claude-result-session-1-1",
              engine: "claude",
              model: "claude-sonnet-4-5",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
              requestCount: 3,
              inputTokens: 1200,
              outputTokens: 420,
              durationMs: 1500,
              costUSD: 0.0123,
            },
          ],
          upstreamRequestCount: 42,
        })}
      />,
    );

    expect(markup).toContain("aria-label=\"Session Details\"");
    expect(markup).toContain(">42</span>");
  });

  it("keeps the upstream request list constrained to one visible request", () => {
    expect(UPSTREAM_REQUEST_SCROLL_AREA_CLASS).toContain("h-[9.5rem]");
    expect(UPSTREAM_REQUEST_SCROLL_AREA_CLASS).not.toContain("max-h-72");
  });
});
