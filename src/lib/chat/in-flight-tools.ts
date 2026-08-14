import type { UIMessage } from "@/types";

export function markInFlightToolCallsFailed(
  messages: UIMessage[],
  reason: string,
): UIMessage[] {
  let changed = false;

  const next = messages.map((message) => {
    const isInFlightTool =
      message.role === "tool_call" &&
      !message.toolResult &&
      !message.toolError;
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
      ...(isRunningSubagent ? { subagentStatus: "failed" as const } : {}),
      ...(message.isStreaming ? { isStreaming: false } : {}),
    };
  });

  return changed ? next : messages;
}

/**
 * Runtime-only progress flags cannot survive an application restart. Finalize
 * them before rendering persisted history so interrupted tools do not keep
 * showing spinners or streaming animations without a backing process.
 */
export function finalizeInterruptedMessages(
  messages: UIMessage[],
  reason = "PccAgent exited before this operation completed.",
): UIMessage[] {
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
    };
  });

  return changed ? finalized : messages;
}
