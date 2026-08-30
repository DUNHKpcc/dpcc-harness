import type { Dispatch, SetStateAction } from "react";
import type { ImageAttachment, UIMessage } from "@/types";
import { createSystemMessage, createUserMessage } from "@/lib/message-factory";

type MessageSetter = Dispatch<SetStateAction<UIMessage[]>>;

interface EngineHookSlice {
  setMessages: MessageSetter;
  setIsProcessing?: Dispatch<SetStateAction<boolean>>;
}

interface ContinueWeChatParams {
  sessionId: string;
  text: string;
  images: ImageAttachment[] | undefined;
  displayText: string | undefined;
  acp: EngineHookSlice;
  /** Track the session as live (single-pane queue/processing bookkeeping); omit in split panes. */
  markLive?: (sessionId: string, live: boolean) => void;
}

/**
 * Continue a WeChat conversation from the desktop. Shared by single-pane
 * (`useSessionLifecycle`) and split-pane (`usePaneController`) send paths so the
 * flow stays identical. The bridge owns the Pi child while its ACP updates and
 * canonical terminal outcome are forwarded to this session's normal ACP hook.
 */
export async function continueWeChatSession({
  sessionId,
  text,
  images,
  displayText,
  acp,
  markLive,
}: ContinueWeChatParams): Promise<void> {
  acp.setMessages((prev) => [...prev, createUserMessage(text, images, displayText)]);
  if (images?.length) {
    markLive?.(sessionId, false);
    acp.setIsProcessing?.(false);
    acp.setMessages((prev) => [
      ...prev,
      createSystemMessage("微信桌面续聊暂不支持图片附件，请改为文本消息。", true),
    ]);
    return;
  }

  markLive?.(sessionId, true);
  acp.setIsProcessing?.(true);
  try {
    const result = await window.claude.wechat.send({ sessionId, text });
    if (result.ok) return;
    markLive?.(sessionId, false);
    acp.setIsProcessing?.(false);
    acp.setMessages((prev) => [
      ...prev,
      createSystemMessage(result.error || "微信 Pi 会话发送失败。", true),
    ]);
  } catch (err) {
    markLive?.(sessionId, false);
    acp.setIsProcessing?.(false);
    acp.setMessages((prev) => [
      ...prev,
      createSystemMessage(err instanceof Error ? err.message : String(err), true),
    ]);
  }
}
