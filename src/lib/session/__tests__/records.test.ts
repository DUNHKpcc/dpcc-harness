import { describe, expect, it } from "vitest";
import type { ChatSession, UIMessage } from "@/types";
import { buildPersistedSession, toChatSession } from "../records";

describe("session records", () => {
  it("keeps folder, pin, and branch metadata when hydrating sidebar sessions", () => {
    const session = toChatSession({
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      lastMessageAt: 200,
      totalCost: 12,
      engine: "claude",
      folderId: "folder-1",
      pinned: true,
      branch: "feature/test",
    }, false);

    expect(session.folderId).toBe("folder-1");
    expect(session.pinned).toBe(true);
    expect(session.branch).toBe("feature/test");
    expect(session.isActive).toBe(false);
  });

  it("keeps folder, pin, and branch metadata when building persisted sessions", () => {
    const session: ChatSession = {
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      totalCost: 12,
      isActive: true,
      engine: "claude",
      folderId: "folder-1",
      pinned: true,
      branch: "feature/test",
    };
    const messages: UIMessage[] = [{
      id: "message-1",
      role: "user",
      content: "hi",
      timestamp: 101,
    }];

    const persisted = buildPersistedSession(session, messages, 12, null);

    expect(persisted.folderId).toBe("folder-1");
    expect(persisted.pinned).toBe(true);
    expect(persisted.branch).toBe("feature/test");
    expect(persisted.messages).toEqual(messages);
  });

  it("keeps upstream request log metadata when hydrating and persisting sessions", () => {
    const requestLog = [{
      id: "request-1",
      engine: "claude" as const,
      model: "claude-sonnet-4-5",
      status: "completed" as const,
      startedAt: 100,
      completedAt: 200,
      requestCount: 2,
      inputTokens: 1200,
      outputTokens: 300,
      costUSD: 0.04,
    }];
    const session = toChatSession({
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      lastMessageAt: 200,
      totalCost: 12,
      engine: "claude",
      upstreamRequestCount: 42,
      requestLog,
    } as any, false);

    expect((session as any).requestLog).toEqual(requestLog);
    expect((session as any).upstreamRequestCount).toBe(42);

    const persisted = buildPersistedSession(session, [], 12, null);

    expect((persisted as any).requestLog).toEqual(requestLog);
    expect((persisted as any).upstreamRequestCount).toBe(42);
  });

  it("defaults old sessions to the visible request log count", () => {
    const session = toChatSession({
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      lastMessageAt: 200,
      totalCost: 12,
      engine: "claude",
      requestLog: [
        {
          id: "request-1",
          engine: "claude",
          status: "completed",
          startedAt: 100,
          requestCount: 2,
        },
      ],
    } as any, false);

    expect((session as any).upstreamRequestCount).toBe(2);
  });
});
