import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { estimateRowHeight } from "@/lib/chat/virtualization";
import { shouldRenderChatContentImmediately } from "../ChatView";
import { MessageBubble } from "../MessageBubble";
import { TooltipProvider } from "../ui/tooltip";

function createImageMessage(imageCount: number): UIMessage {
  return {
    id: "message-with-images",
    role: "user",
    content: "",
    timestamp: 0,
    images: Array.from({ length: imageCount }, (_, index) => ({
      id: `image-${index}`,
      data: `raw-image-${index}`,
      mediaType: "image/png" as const,
      fileName: `image-${index}.png`,
    })),
  };
}

describe("ChatView", () => {
  it("renders existing chat content immediately on remount instead of flashing a spinner", () => {
    expect(shouldRenderChatContentImmediately(1)).toBe(true);
  });

  it("keeps the empty initial state available for deferred loading", () => {
    expect(shouldRenderChatContentImmediately(0)).toBe(false);
  });

  it("keeps sent image attachments outside the text bubble in a responsive horizontal strip", () => {
    const message = createImageMessage(4);
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MessageBubble, { message }),
      ),
    );

    expect(html).toContain('data-slot="message-image-strip"');
    expect(html).toContain("max-w-full");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("object-cover");
    expect((html.match(/data-slot="message-image-thumbnail"/g) ?? [])).toHaveLength(4);
    expect((html.match(/size-20/g) ?? [])).toHaveLength(4);
    expect(html).not.toContain('data-slot="user-message-bubble"');
    expect(html).toContain('src="data:image/png;base64,raw-image-0"');
    expect(estimateRowHeight({ kind: "message", msg: message, originalIndex: 0 })).toBe(88);

    const messageWithText: UIMessage = { ...message, content: "caption" };
    const htmlWithText = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MessageBubble, { message: messageWithText }),
      ),
    );
    const stripIndex = htmlWithText.indexOf('data-slot="message-image-strip"');
    const bubbleIndex = htmlWithText.indexOf('data-slot="user-message-bubble"');
    expect(stripIndex).toBeGreaterThanOrEqual(0);
    expect(bubbleIndex).toBeGreaterThan(stripIndex);
  });
});
