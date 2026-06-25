import { describe, expect, it } from "vitest";
import { shouldRenderChatContentImmediately } from "./ChatView";

describe("ChatView", () => {
  it("renders existing chat content immediately on remount instead of flashing a spinner", () => {
    expect(shouldRenderChatContentImmediately(1)).toBe(true);
  });

  it("keeps the empty initial state available for deferred loading", () => {
    expect(shouldRenderChatContentImmediately(0)).toBe(false);
  });
});
