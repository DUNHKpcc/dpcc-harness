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


describe("sent file references", () => {
  it("renders file cards at image-thumbnail size and omits the raw path block from the text bubble", () => {
    const message: UIMessage = {
      id: "user-file",
      role: "user",
      content: "看一下这个文档\n\nAttached local file references:\n- /Users/me/very-long-document.docx",
      displayContent: "看一下这个文档\n\nAttached local file references:\n- /Users/me/very-long-document.docx",
      timestamp: 0,
    };
    const html = renderMessage(message);

    expect(html).toContain('data-slot="message-attachment-strip"');
    expect(html).toContain('data-variant="message"');
    expect(html).toContain('data-slot="file-attachment-tile"');
    expect(html).toContain("size-20");
    expect(html).toContain("text-blue-600");
    expect(html).toContain("看一下这个文档");
    expect(html).not.toContain("Attached local file references:");
    expect(html).not.toContain("<span>/Users/me/");
  });

  it("renders a file-only message without an empty text bubble", () => {
    const html = renderMessage({
      id: "user-file-only", role: "user", timestamp: 0,
      content: "Please use these local file references as needed:\n- C:\\Users\\me\\notes.pdf",
    });

    expect(html).toContain('data-slot="message-attachment-strip"');
    expect(html).toContain("text-red-600");
    expect(html).not.toContain('data-slot="user-message-bubble"');
  });
});
