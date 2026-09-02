import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "@/types";
import { MessageBubble } from "../MessageBubble";
import { TooltipProvider } from "../ui/tooltip";

function renderMessage(message: UIMessage, onEditMessage?: (text: string) => void): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MessageBubble
        message={message}
        onEditMessage={onEditMessage}
      />
    </TooltipProvider>,
  );
}

describe("MessageBubble message actions", () => {
  it("renders copy and edit actions below an editable user message", () => {
    const message: UIMessage = {
      id: "user-1",
      role: "user",
      content: "Continue",
      displayContent: "Continue",
      timestamp: 0,
    };

    const markup = renderMessage(message, vi.fn());

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('aria-label="Edit message"');
    expect(markup).toContain("Continue");
  });

  it("keeps copy available for read-only user messages without an edit action", () => {
    const message: UIMessage = {
      id: "user-2",
      role: "user",
      content: "Historical question",
      timestamp: 0,
    };

    const markup = renderMessage(message);

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).not.toContain('aria-label="Edit message"');
  });

  it("renders the answer copy action below assistant content", () => {
    const message: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Here is the answer.",
      timestamp: 0,
    };

    const markup = renderMessage(message);

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain("Here is the answer.");
  });
});
