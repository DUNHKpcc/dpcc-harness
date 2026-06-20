import type { Dispatch, SetStateAction } from "react";
import type { EngineId, ImageAttachment, UIMessage } from "@/types";
import { createSystemMessage, createUserMessage } from "@/lib/message-factory";

type MessageSetter = Dispatch<SetStateAction<UIMessage[]>>;

/** Minimal slice of the Claude engine hook the WeChat continuation needs. */
interface ClaudeHookSlice {
  setMessages: MessageSetter;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
}

/** Minimal slice of the Codex engine hook (only used to surface the unsupported notice). */
interface CodexHookSlice {
  setMessages: MessageSetter;
}

interface ContinueWeChatParams {
  sessionId: string;
  engine: EngineId | undefined;
  text: string;
  images: ImageAttachment[] | undefined;
  displayText: string | undefined;
  claude: ClaudeHookSlice;
  codex: CodexHookSlice;
  /** Track the session as live (single-pane queue/processing bookkeeping); omit in split panes. */
  markLive?: (sessionId: string, live: boolean) => void;
}

/**
 * Continue a WeChat conversation from the desktop. Shared by single-pane
 * (`useSessionLifecycle`) and split-pane (`usePaneController`) send paths so the
 * flow stays identical. Claude streams back over `claude:event`; Codex isn't
 * supported yet (its adapter doesn't forward events) so it surfaces a notice.
 */
export async function continueWeChatSession({
  sessionId,
  engine,
  text,
  images,
  displayText,
  claude,
  codex,
  markLive,
}: ContinueWeChatParams): Promise<void> {
  if (engine === "codex") {
    codex.setMessages((prev) => [
      ...prev,
      createSystemMessage("Codex 微信对话暂不支持桌面续聊，请在手机端继续。", true),
    ]);
    return;
  }

  claude.setMessages((prev) => [...prev, createUserMessage(text, images, displayText)]);
  claude.setIsProcessing(true);
  markLive?.(sessionId, true);

  const res = await window.claude.wechat.send({ sessionId, text });
  if (!res.ok) {
    markLive?.(sessionId, false);
    claude.setIsProcessing(false);
    claude.setMessages((prev) => [
      ...prev,
      createSystemMessage(res.error || "微信续聊失败", true),
    ]);
  }
}
