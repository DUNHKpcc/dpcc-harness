import type { UIMessage } from "@/types";

/** Local transcript edits never change ACP/Pi context or undo tool actions. */
export function canDeleteMessage(
  message: UIMessage,
  blocked: boolean,
): boolean {
  return (message.role === "user" || message.role === "assistant")
    && !message.isStreaming
    && (!blocked || !!message.isQueued);
}

/** Resolve local reply ownership, including records whose question was deleted. */
function getReplyOwners(messages: UIMessage[]): Map<string, string> {
  const owners = new Map<string, string>();
  let owner: string | undefined;
  for (const message of messages) {
    if (message.isQueued) continue;
    if (message.role === "user") {
      owner = message.id;
      continue;
    }
    owner = message.replyToMessageId ?? owner ?? message.id;
    owners.set(message.id, owner);
  }
  return owners;
}

/** A user edit removes one record; an assistant edit removes its entire reply. */
export function getMessageDeletionPlan(messages: UIMessage[], messageId: string): {
  deleted: UIMessage[];
  next: UIMessage[];
} {
  const target = messages.find((message) => message.id === messageId);
  if (!target || target.isQueued || !canDeleteMessage(target, false)) {
    return { deleted: [], next: messages };
  }
  const owners = getReplyOwners(messages);
  const owner = owners.get(messageId);
  const deleted = target.role === "assistant"
    ? messages.filter((message) => owners.has(message.id) && owners.get(message.id) === owner)
    : [target];
  const deletedIds = new Set(deleted.map((message) => message.id));
  const next = messages.filter((message) => !deletedIds.has(message.id)).map((message) => (
    // Persist this boundary before removing the question, so adjacent replies
    // cannot merge even after a reload or a stale autosave.
    target.role === "user" && owners.get(message.id) === messageId
      ? { ...message, replyToMessageId: messageId }
      : message
  ));
  return { deleted, next };
}

/** Restore the entire failed edit in original order without dropping new records. */
export function restoreDeletedMessages(
  messages: UIMessage[],
  deleted: UIMessage[],
  original: UIMessage[],
): UIMessage[] {
  const deletedIds = new Set(deleted.map((message) => message.id));
  const presentIds = new Set(messages.map((message) => message.id));
  const originalIds = new Set(original.map((message) => message.id));
  const insertBefore = new Map<string, UIMessage[]>();
  let pending: UIMessage[] = [];
  for (const message of original) {
    if (presentIds.has(message.id)) {
      if (pending.length > 0) insertBefore.set(message.id, pending);
      pending = [];
    } else if (deletedIds.has(message.id)) {
      pending.push(message);
    }
  }
  // Restore gaps before their surviving successor; restore the tail before
  // newly appended records. Linear merging keeps long transcripts responsive.
  let tailIndex = 0;
  for (let i = 0; i < messages.length; i++) {
    if (originalIds.has(messages[i].id)) tailIndex = i + 1;
  }
  const restored: UIMessage[] = [];
  for (let i = 0; i <= messages.length; i++) {
    if (i === tailIndex) restored.push(...pending);
    if (i < messages.length) {
      const message = messages[i];
      restored.push(...(insertBefore.get(message.id) ?? []), message);
    }
  }
  return restored;
}
