import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { MessageBubble } from "../MessageBubble";
import { TooltipProvider } from "../ui/tooltip";

function renderMessage(message: UIMessage): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MessageBubble
        message={message}
      />
    </TooltipProvider>,
  );
}

describe("MessageBubble message actions", () => {
  it("renders a hover-only copy action below a user message", () => {
    const message: UIMessage = {
      id: "user-1",
      role: "user",
      content: "Continue",
      displayContent: "Continue",
      timestamp: 0,
    };

    const markup = renderMessage(message);

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain("h-5 w-5");
    expect(markup).toContain("h-2.5 w-2.5");
    expect(markup).toContain("group-hover/user:opacity-100");
    expect(markup).toContain("Continue");
  });

  it("renders copy for historical user messages", () => {
    const message: UIMessage = {
      id: "user-2",
      role: "user",
      content: "Historical question",
      timestamp: 0,
    };

    const markup = renderMessage(message);

    expect(markup).toContain('aria-label="Copy"');
  });

  it("renders a hover-only answer copy action below assistant content", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Here is the answer.",
      timestamp: 0,
    };

    const markup = renderMessage(message);

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain("group-hover/assistant:opacity-100");
    expect(markup).toContain("Here is the answer.");
  });
});
