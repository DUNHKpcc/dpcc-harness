export interface RecoverableSessionMessage {
  role: string;
  isQueued?: boolean;
  isStreaming?: boolean;
  thinking?: unknown;
  thinkingComplete?: boolean;
  toolError?: boolean;
  toolResult?: unknown;
  toolInput?: Record<string, unknown>;
  subagentStatus?: string;
}

export interface RecoverableRequestRecord {
  status: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  note?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RecoverablePersistedSession<
  Message extends RecoverableSessionMessage,
  Request extends RecoverableRequestRecord,
> {
  messages: Message[];
  requestLog?: Request[];
  isProcessing?: boolean;
}

export const APP_RESTART_INTERRUPTED_CODE = "app_restart_interrupted";
export const APP_RESTART_INTERRUPTED_MESSAGE = "PccAgent exited before this operation completed.";

export function markInFlightToolCallsFailed<Message extends RecoverableSessionMessage>(
  messages: Message[],
  reason: string,
): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    const isInFlightTool = message.role === "tool_call" && !message.toolResult && !message.toolError;
    const isRunningSubagent = message.subagentStatus === "running";
    if (!isInFlightTool && !isRunningSubagent) return message;

    changed = true;
    return {
      ...message,
      toolError: true,
      toolResult: message.toolResult ?? {
        type: "text",
        content: reason,
        status: "failed",
      },
      ...(isRunningSubagent ? { subagentStatus: "failed" } : {}),
      ...(message.isStreaming ? { isStreaming: false } : {}),
    } as Message;
  });
  return changed ? next : messages;
}

/** Finalize runtime-only message state before persisted history is rendered. */
export function finalizeInterruptedMessages<Message extends RecoverableSessionMessage>(
  messages: Message[],
  reason = APP_RESTART_INTERRUPTED_MESSAGE,
): Message[] {
  const withoutQueued = messages.filter((message) => !message.isQueued);
  let changed = withoutQueued.length !== messages.length;
  const finalizedTools = markInFlightToolCallsFailed(withoutQueued, reason);
  if (finalizedTools !== withoutQueued) changed = true;

  const finalized = finalizedTools.map((message) => {
    const todos = message.role === "tool_call" && Array.isArray(message.toolInput?.todos)
      ? message.toolInput.todos
      : null;
    const hasInProgressTodo = todos?.some((todo) => (
      typeof todo === "object"
      && todo !== null
      && "status" in todo
      && todo.status === "in_progress"
    )) ?? false;
    if (!message.isStreaming && !hasInProgressTodo) return message;

    changed = true;
    return {
      ...message,
      ...(message.isStreaming ? {
        isStreaming: false,
        ...(message.role === "assistant" && message.thinking
          ? { thinkingComplete: true }
          : {}),
      } : {}),
      ...(hasInProgressTodo && todos ? {
        toolInput: {
          ...message.toolInput,
          todos: todos.map((todo) => (
            typeof todo === "object"
            && todo !== null
            && "status" in todo
            && todo.status === "in_progress"
              ? { ...todo, status: "pending" }
              : todo
          )),
        },
      } : {}),
    } as Message;
  });

  return changed ? finalized : messages;
}

export function finalizeInterruptedRequests<Request extends RecoverableRequestRecord>(
  records: Request[],
  reason = APP_RESTART_INTERRUPTED_MESSAGE,
  now = Date.now(),
): Request[] {
  let changed = false;
  const finalized = records.map((record) => {
    if (record.status !== "pending") return record;
    changed = true;
    return {
      ...record,
      status: "failed",
      completedAt: now,
      ...(typeof record.startedAt === "number" ? { durationMs: Math.max(0, now - record.startedAt) } : {}),
      errorCode: APP_RESTART_INTERRUPTED_CODE,
      errorMessage: reason,
      note: reason,
    } as Request;
  });
  return changed ? finalized : records;
}

/** Canonical restart recovery used by both the renderer and the Electron E2E. */
export function normalizeInterruptedSession<
  Message extends RecoverableSessionMessage,
  Request extends RecoverableRequestRecord,
  Session extends RecoverablePersistedSession<Message, Request>,
>(
  session: Session,
  reason = APP_RESTART_INTERRUPTED_MESSAGE,
  now = Date.now(),
): Session {
  const messages = finalizeInterruptedMessages(session.messages, reason);
  const requestLog = session.requestLog
    ? finalizeInterruptedRequests(session.requestLog, reason, now)
    : session.requestLog;
  const changed = messages !== session.messages
    || requestLog !== session.requestLog
    || session.isProcessing === true;
  if (!changed) return session;
  return {
    ...session,
    messages,
    ...(requestLog ? { requestLog } : {}),
    ...(session.isProcessing === true ? { isProcessing: false } : {}),
  };
}
