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
