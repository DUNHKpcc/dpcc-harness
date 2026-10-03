import type { UIMessage } from "@/types";
import { parseLocalFileReferences } from "./local-file-references";

/** Keep injected file, folder and browser context out of user-facing previews. */
export function userMessageText(message: Pick<UIMessage, "content" | "displayContent">): string {
  return parseLocalFileReferences(message.displayContent ?? message.content).text
    .replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "")
    .replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "")
    .replace(/<element [^>]*>[\s\S]*?<\/element>\s*/g, "")
    .trim();
}
