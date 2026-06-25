import { describe, expect, it } from "vitest";
import { buildCodexUserInput } from "./codex-adapter";

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
