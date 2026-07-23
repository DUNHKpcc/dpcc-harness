import { describe, expect, it } from "vitest";
import {
  buildSessionCacheKey,
  computeFilePanelData,
  getCachedFilePanelData,
} from "../../../../src/lib/session/derived-data";
import type { UIMessage } from "../../../../src/types";
import {
  formatTraySessionLabel,
  selectRecentTraySessions,
} from "../tray-menu";
import type { SessionMeta } from "@shared/lib/session-persistence";

function makeUserMessage(id: string, content: string, timestamp: number): UIMessage {
  return {
    id,
    role: "user",
    content,
    timestamp,
  };
}

function makeToolCall(id: string, toolName: string, toolInput: Record<string, unknown>, timestamp: number): UIMessage {
  return {
    id,
    role: "tool_call",
    content: "",
    timestamp,
    toolName,
    toolInput,
  };
}

describe("session-derived-data", () => {
  it("caches file panel data per session and tracks the latest tool call for a file", () => {
    const messages: UIMessage[] = [
      makeUserMessage("u1", "read config", 1),
      makeToolCall("t1", "Read", { file_path: "/repo/src/app.ts" }, 2),
      makeToolCall("t2", "Edit", { file_path: "/repo/src/app.ts", old_string: "a", new_string: "b" }, 3),
    ];
    const cacheKey = buildSessionCacheKey("session-a", messages, "files");

    const first = computeFilePanelData("session-a", cacheKey, messages, "/repo");
    const cached = getCachedFilePanelData("session-a", cacheKey);
    const second = computeFilePanelData("session-a", cacheKey, messages, "/repo");

    expect(first.files).toHaveLength(1);
    expect(first.files[0]?.path).toBe("/repo/src/app.ts");
    expect(first.lastToolCallIdByFile.get("/repo/src/app.ts")).toBe("t2");
    expect(cached).toBe(first);
    expect(second).toBe(first);
  });
});

describe("tray recent sessions", () => {
  const makeSession = (
    id: string,
    lastMessageAt: number,
    engine: SessionMeta["engine"],
    projectId = "project-a",
  ): SessionMeta => ({
    id,
    projectId,
    title: `Session ${id}`,
    createdAt: lastMessageAt,
    lastMessageAt,
    engine,
  });

  it("selects the three most recently active sessions across engines", () => {
    const sessions = [
      makeSession("claude-old", 10, "claude"),
      makeSession("codex-new", 40, "codex"),
      makeSession("acp-mid", 20, "acp"),
      makeSession("chat-newest", 50, "claude", "__harnss_chat__"),
      makeSession("claude-recent", 30, "claude"),
    ];

    expect(selectRecentTraySessions(sessions).map((session) => session.id)).toEqual([
      "chat-newest",
      "codex-new",
      "claude-recent",
    ]);
  });

  it("formats compact engine and Chat module labels", () => {
    expect(formatTraySessionLabel({
      engine: "codex",
      projectId: "project-a",
      title: "Fix tray menu",
    })).toBe("Codex · Fix tray menu");
    expect(formatTraySessionLabel({
      engine: "claude",
      projectId: "__harnss_chat__",
      title: "General chat",
    })).toBe("Chat · Claude · General chat");
  });
});
