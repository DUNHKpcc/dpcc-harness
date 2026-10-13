import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatSession, PersistedSession, UIMessage } from "@/types";
import { BackgroundSessionStore } from "@/lib/background/session-store";
import { getSplitPaneStateSnapshot, publishSplitPaneStateSnapshot, removeSplitPaneStateSnapshot, type SplitPaneStateSnapshot } from "@/lib/split-pane-state";
import { useSessionPersistence } from "../useSessionPersistence";
import type { SessionPaneState } from "../useSessionPane";

vi.mock("react", () => ({
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(current: T) => ({ current }),
  useEffect: () => {},
  useState: <T,>(current: T) => [current, vi.fn()],
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const question: UIMessage = { id: "question", role: "user", content: "Question", timestamp: 1 };
const answer: UIMessage = { id: "answer", role: "assistant", content: "Answer", thinking: "Reasoning", timestamp: 2 };
const tool: UIMessage = { id: "tool", role: "tool_call", content: "", toolName: "Read", timestamp: 3 };

function harness(messages: UIMessage[] = [question, answer, tool], engineId = "acp") {
  const session: ChatSession = {
    id: "session", projectId: "project", title: "Title", createdAt: 1,
    engine: engineId as ChatSession["engine"], agentId: engineId === "acp" ? "pi-acp" : undefined,
    agentSessionId: "native-session", totalCost: 12, upstreamRequestCount: 7,
    requestLog: [], isActive: true, folderId: "folder", pinned: true,
  };
  const engine = {
    messages, messagesRef: { current: messages }, isProcessing: false,
    isCompacting: false, isConnected: false, pendingPermission: null,
    totalCost: 12, upstreamRequestCount: 7, requestLog: [], contextUsage: null,
    sessionInfo: null,
    setMessages: vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
      engine.messages = typeof update === "function" ? update(engine.messagesRef.current) : update;
      engine.messagesRef.current = engine.messages;
    }),
  };
  const original: PersistedSession = {
    ...session, messages, codexThreadId: "legacy-thread", codexRolloutPath: "/legacy.jsonl",
    totalCost: 12, contextUsage: null,
  };
  const save = vi.fn(async (_data: PersistedSession): Promise<{ ok?: boolean; error?: string }> => ({ ok: true }));
  const load = vi.fn(async () => original);
  const start = vi.fn();
  vi.stubGlobal("window", { claude: { sessions: { save, load }, acp: { start } } });
  const background = new BackgroundSessionStore();
  background.initFromState("session", {
    messages, isProcessing: false, isCompacting: false, isConnected: false,
    sessionInfo: null, totalCost: 12, upstreamRequestCount: 7, requestLog: [],
    contextUsage: null, pendingPermission: null, rawAcpPermission: null, slashCommands: [],
  });
  const refs = {
    activeSessionIdRef: { current: "session" }, sessionsRef: { current: [session] },
    installedAgentsRef: { current: [] }, messagesRef: engine.messagesRef,
    totalCostRef: { current: 12 }, upstreamRequestCountRef: { current: 7 },
    requestLogRef: { current: [] }, contextUsageRef: { current: null },
    sessionInfoRef: { current: null }, backgroundStoreRef: { current: background },
    saveTimerRef: { current: null },
  };
  const persistence = useSessionPersistence({
    refs, setters: {}, engines: { acp: engine, engine }, activeSessionId: "session",
  } as unknown as Parameters<typeof useSessionPersistence>[0]);
  return { persistence, refs, engine, save, load, start, original, background };
}

afterEach(() => { removeSplitPaneStateSnapshot("split"); vi.unstubAllGlobals(); });

describe("explicit local message deletion persistence", () => {
  it("removes the entire reply and preserves costs and native identity", async () => {
    const { persistence, engine, save, start, background } = harness();
    await persistence.deleteMessage("session", "answer");
    expect(engine.messages.map((message) => message.id)).toEqual(["question"]);
    expect(background.get("session")?.messages.map((message) => message.id)).toEqual(["question"]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      messages: [question], totalCost: 12, upstreamRequestCount: 7,
      agentSessionId: "native-session", folderId: "folder", pinned: true,
    }));
    expect(start).not.toHaveBeenCalled();
  });

  it("persists reply ownership when removing a question, including stale autosaves", async () => {
    const nextQuestion: UIMessage = { ...question, id: "second-question" };
    const nextAnswer: UIMessage = { ...answer, id: "second-answer" };
    const messages = [question, answer, nextQuestion, tool, nextAnswer];
    const { persistence, engine, refs, save, background } = harness(messages);
    await persistence.deleteMessage("session", "second-question");
    expect(background.get("session")?.messages.at(-1)?.replyToMessageId).toBe("second-question");
    refs.messagesRef.current = messages;
    await persistence.saveCurrentSession();
    const saved = save.mock.calls.at(-1)![0].messages;
    expect(saved.map((message) => message.id)).toEqual(["question", "answer", "tool", "second-answer"]);
    expect(saved.at(-1)?.replyToMessageId).toBe("second-question");
    engine.setMessages(saved);
    await persistence.deleteMessage("session", "second-answer");
    expect(engine.messages).toEqual([question, answer]);
  });

  it("restores all reply records in the pane and background after a failed save", async () => {
    const thinking: UIMessage = { ...answer, id: "thinking", content: "", thinking: "Reasoning" };
    const result: UIMessage = { ...tool, id: "result", role: "tool_result" };
    const queued: UIMessage = { ...question, id: "queued", isQueued: true };
    const messages = [question, thinking, tool, queued, result, answer];
    const { persistence, save, engine, background } = harness(messages);
    save.mockImplementationOnce(async () => {
      engine.setMessages((previous) => [...previous, { ...question, id: "new" }]);
      return { error: "disk full" };
    });
    await expect(persistence.deleteMessage("session", "answer")).rejects.toThrow("disk full");
    expect(engine.messages.slice(0, messages.length)).toEqual(messages);
    expect(engine.messages.map((message) => message.id)).toContain("new");
    expect(background.get("session")?.messages).toEqual(messages);
    expect(save.mock.calls.at(-1)![0].messages.filter((message) => message.failureStatus !== "persistence_failed").map((message) => message.id))
      .toEqual(["question", "thinking", "tool", "result", "answer", "new"]);
  });

  it("explicitly persists an empty transcript when deleting the final message", async () => {
    const { persistence, save, engine } = harness([question]);
    await persistence.deleteMessage("session", "question");
    expect(engine.messages).toEqual([]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "session", messages: [] }));
  });

  it.each(["claude", "codex"])("preserves the complete historical %s record without starting a runtime", async (engineId) => {
    const { persistence, save, start, original } = harness([question, answer], engineId);
    await persistence.deleteMessage("session", "question");
    expect(save).toHaveBeenCalledWith({ ...original, messages: [{ ...answer, replyToMessageId: "question" }] });
    expect(start).not.toHaveBeenCalled();
  });

  it("blocks tool deletion, processing, compaction, streaming and queued history edits", async () => {
    const { persistence, save, engine } = harness();
    await persistence.deleteMessage("session", "tool");
    engine.isProcessing = true;
    await persistence.deleteMessage("session", "answer");
    engine.isProcessing = false;
    engine.isCompacting = true;
    await persistence.deleteMessage("session", "answer");
    engine.isCompacting = false;
    engine.messagesRef.current = [{ ...answer, isStreaming: true }, { ...question, isQueued: true }];
    await persistence.deleteMessage("session", "answer");
    await persistence.deleteMessage("session", "question");
    expect(save).not.toHaveBeenCalled();
  });

  it("restores a failed deletion without replacing newer messages", async () => {
    const { persistence, save, engine } = harness([question, answer]);
    save.mockImplementationOnce(async () => {
      engine.setMessages((previous) => [...previous, { ...question, id: "new" }]);
      return { error: "disk full" };
    });
    await expect(persistence.deleteMessage("session", "answer")).rejects.toThrow("disk full");
    expect(engine.messages.map((message) => message.id).slice(0, 3)).toEqual(["question", "answer", "new"]);
  });

  it("serializes pending writes and filters deleted IDs out of stale autosave snapshots", async () => {
    const { persistence, save, refs, engine } = harness();
    let release!: () => void;
    save.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
    const deletion = persistence.deleteMessage("session", "answer");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    refs.messagesRef.current = [question, answer, tool]; // a previously captured autosave
    const autosave = persistence.saveCurrentSession();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([deletion, autosave]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].messages).toEqual([question]);
    engine.messagesRef.current = [question];
  });

  it("persists rollback after a stale autosave queued behind a slow failed deletion", async () => {
    const { persistence, save } = harness([question, answer]);
    let fail!: () => void;
    save.mockImplementationOnce(() => new Promise((resolve) => {
      fail = () => resolve({ error: "temporary write failure" });
    }));
    const deletion = persistence.deleteMessage("session", "answer");
    const failure = expect(deletion).rejects.toThrow("temporary write failure");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const autosave = persistence.saveCurrentSession();
    fail();
    await Promise.all([failure, autosave]);
    expect(save.mock.calls.at(-1)?.[0].messages.map((message) => message.id)).toContain("answer");
  });

  it("deletes in a secondary pane without changing the primary transcript", async () => {
    const { persistence, refs, engine, save } = harness();
    refs.sessionsRef.current.push({ ...refs.sessionsRef.current[0], id: "split" });
    const splitEngine = {
      ...engine, messages: [question, answer, tool], messagesRef: { current: [question, answer, tool] },
      setMessages: vi.fn(),
    };
    publishSplitPaneStateSnapshot({
      ...splitEngine, sessionId: "split", configOptions: [], slashCommands: [], rawAcpPermission: null,
    } as unknown as SplitPaneStateSnapshot);
    await persistence.deleteMessage("split", "answer", {
      ...splitEngine, engine: splitEngine,
    } as unknown as SessionPaneState);
    expect(engine.messages).toEqual([question, answer, tool]);
    expect(splitEngine.messagesRef.current).toEqual([question]);
    expect(getSplitPaneStateSnapshot("split")?.messages).toEqual([question]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "split", messages: [question] }));
  });

  it("does not restore a failed deletion into a different primary session after switching", async () => {
    const { persistence, refs, engine, save } = harness();
    save.mockImplementationOnce(async () => {
      refs.activeSessionIdRef.current = "other";
      engine.setMessages([{ ...question, id: "other-user" }]);
      return { error: "disk full" };
    });
    await expect(persistence.deleteMessage("session", "answer")).rejects.toThrow("disk full");
    expect(engine.messages.map((message) => message.id)).toEqual(["other-user"]);
  });
});
