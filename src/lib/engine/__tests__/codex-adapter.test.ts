import { describe, expect, it } from "vitest";
import type { CodexThreadItem } from "@/types";
import {
  buildCodexUserInput,
  codexItemToToolInput,
  codexItemToToolName,
  codexItemToToolResult,
} from "../codex-adapter";

describe("buildCodexUserInput", () => {
  it("builds v2 text, image, and mention inputs for Codex turns", () => {
    const input = buildCodexUserInput(
      "Read the referenced files",
      [
        {
          id: "img-1",
          data: "abc123",
          mediaType: "image/png",
          fileName: "screen.png",
        },
      ],
      [
        {
          name: "large.txt",
          path: "/tmp/large.txt",
        },
      ],
    );

    expect(input).toEqual([
      {
        type: "text",
        text: "Read the referenced files",
        text_elements: [],
      },
      {
        type: "image",
        url: "data:image/png;base64,abc123",
      },
      {
        type: "mention",
        name: "large.txt",
        path: "/tmp/large.txt",
      },
    ]);
  });
});

describe("Codex collab agent tool calls", () => {
  const item = {
    type: "collabAgentToolCall",
    id: "collab-1",
    tool: "spawnAgent",
    status: "completed",
    senderThreadId: "parent",
    receiverThreadIds: ["child"],
    prompt: "Review the implementation",
    agentsStates: {
      child: { status: "completed", message: "Done" },
    },
  } as CodexThreadItem;

  it("renders as a Task card with its terminal result", () => {
    expect(codexItemToToolName(item)).toBe("Task");
    expect(codexItemToToolInput(item)).toMatchObject({
      description: "Review the implementation",
      subagent_type: "spawnAgent",
      receiver_thread_ids: ["child"],
    });
    expect(codexItemToToolResult(item)).toMatchObject({
      type: "text",
      status: "completed",
      content: "Review the implementation",
    });
  });
});
