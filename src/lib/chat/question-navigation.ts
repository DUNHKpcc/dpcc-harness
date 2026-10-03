import type { UIMessage } from "@/types";
import { localFileName, parseLocalFileReferences } from "./local-file-references";
import { userMessageText } from "./user-message-text";

export interface QuestionEntry {
  id: string;
  text: string;
}

// User messages are immutable; avoid parsing large attachment context on each token.
const entryCache = new WeakMap<UIMessage, QuestionEntry>();

/** Reuse the list while only assistant/tool output changes during streaming. */
export function questionEntries(messages: UIMessage[], previous: QuestionEntry[] = []): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" || message.isQueued) continue;
    const cached = entryCache.get(message);
    if (cached) { entries.push(cached); continue; }
    const text = userMessageText(message)
      || [
        ...parseLocalFileReferences(message.content).paths.map(localFileName),
        ...(message.images ?? []).map((image) => image.fileName).filter(Boolean),
      ].join(", ");
    const entry = { id: message.id, text: text.slice(0, 500) };
    entryCache.set(message, entry);
    entries.push(entry);
  }
  return entries.length === previous.length && entries.every((entry, index) => (
    entry.id === previous[index].id && entry.text === previous[index].text
  )) ? previous : entries;
}
