import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { UIMessage } from "@/types";
import { formatCompactSummary } from "../tool-formatting";

// Minimal stub: returns the key (sufficient for branches that don't hit a t() call).
const t = ((key: string) => key) as unknown as TFunction<"toolcall">;

describe("formatCompactSummary", () => {
  it("does not report Claude multi-hunk single-file edits as multiple files", () => {
    const message: UIMessage = {
      id: "edit-1",
      role: "tool_call",
      content: "",
      toolName: "Edit",
      toolInput: {
        file_path: "/repo/src/LtiTeacherAssignmentPreview.tsx",
        old_string: "old",
        new_string: "new",
        replace_all: false,
      },
      toolResult: {
        filePath: "/repo/src/LtiTeacherAssignmentPreview.tsx",
        oldString: "old",
        newString: "new",
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
          { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1, lines: ["-old2", "+new2"] },
        ],
      },
      timestamp: 0,
    };

    expect(formatCompactSummary(message, t)).toBe("LtiTeacherAssignmentPreview.tsx");
  });
});
