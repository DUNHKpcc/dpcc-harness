import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { questionEntries } from "./question-navigation";
import { userMessageText } from "./user-message-text";

const user = (id: string, content: string): UIMessage => ({ id, role: "user", content, timestamp: 1 });

describe("question navigation", () => {
  it("indexes only sent user messages and hides injected context", () => {
    expect(questionEntries([
      user("first", 'Review this\n<file path="secret.txt">private context</file>'),
      { ...user("assistant", "Answer"), role: "assistant" },
      { ...user("queued", "Not sent"), isQueued: true },
      { ...user("display", "Expanded prompt"), displayContent: "My question" },
    ])).toEqual([
      { id: "first", text: "Review this" },
      { id: "display", text: "My question" },
    ]);
  });

  it("previews attachment-only prompts without exposing full paths", () => {
    expect(questionEntries([
      user("file", "Please use these local file references as needed:\n- C:\\Users\\me\\report.pdf"),
      { ...user("image", ""), images: [{ id: "image", fileName: "diagram.png", mediaType: "image/png", data: "AA==" }] },
      user("empty", ""),
    ])).toEqual([
      { id: "file", text: "report.pdf" },
      { id: "image", text: "diagram.png" },
      { id: "empty", text: "" },
    ]);
  });

  it("preserves list identity during assistant streaming but reflects edits, deletions and queue changes", () => {
    const question = user("first", "Question");
    const previous = questionEntries([question]);
    expect(questionEntries([question, { ...user("answer", "Streaming"), role: "assistant" }], previous)).toBe(previous);
    expect(questionEntries([{ ...question, content: "Edited question" }], previous)).not.toBe(previous);
    expect(questionEntries([], previous)).toEqual([]);
    expect(questionEntries([{ ...question, isQueued: true }], previous)).toEqual([]);
  });

  it("uses the same visible text as the message bubble and bounds long previews", () => {
    const question = user("first", 'Explain\n<folder path="src">tree</folder>\n<element tag="div">markup</element>\n\nAttached local file references:\n- /tmp/report.pdf');
    expect(userMessageText(question)).toBe("Explain");
    expect(questionEntries([user("long", "x".repeat(2_000))])[0].text).toHaveLength(500);
  });
});
