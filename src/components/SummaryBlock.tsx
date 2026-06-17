import { useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronRight, Minimize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { useChatPersistedState } from "@/components/chat-ui-state";
import { CHAT_CARD_ROW_MARGIN_CLASS, CHAT_PROSE_EDGE_CLASS } from "@/components/lib/chat-layout";

const REMARK_PLUGINS = [remarkGfm];

/** Strip markdown syntax to get plain text for the preview line. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")      // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/`(.+?)`/g, "$1")         // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
    .replace(/^[-*]\s+/gm, "")         // list markers
    .replace(/^\d+\.\s+/gm, "")        // numbered lists
    .replace(/\n+/g, " ")              // collapse newlines
    .trim();
}

interface SummaryBlockProps {
  message: UIMessage;
}

export const SummaryBlock = memo(function SummaryBlock({ message }: SummaryBlockProps) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useChatPersistedState(`summary:${message.id}`, false);

  const isCompact = message.compactTrigger === "manual" || message.compactTrigger === "auto";
  const hasContent = !!message.content.trim();

  const typeLabel = message.compactTrigger === "manual"
    ? t("summary.manualCompact")
    : message.compactTrigger === "auto"
      ? t("summary.autoCompact")
      : null;

  const preview = useMemo(() => {
    if (!hasContent) return null;
    const plain = stripMarkdown(message.content);
    return plain.length > 120 ? plain.slice(0, 120) + "..." : plain;
  }, [message.content, hasContent]);

  const Icon = isCompact ? Minimize2 : BookOpen;

  const fallbackLabel = isCompact ? t("summary.contextCompacted") : t("summary.contextResumed");

  return (
    <div className={`flow-root ${CHAT_CARD_ROW_MARGIN_CLASS}`}>
      <button
        type="button"
        onClick={() => hasContent && setIsOpen((prev) => !prev)}
        className={`flex w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-start text-sm text-muted-foreground transition-colors ${
          hasContent ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <span className="flex-1 min-w-0 truncate">
          {typeLabel && (
            <span className="me-1.5 text-xs text-muted-foreground/50">{typeLabel}</span>
          )}
          <span className="font-medium">
            {preview ?? fallbackLabel}
          </span>
        </span>
        {message.compactPreTokens != null && (
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {t("summary.tokens", { amount: (message.compactPreTokens / 1000).toFixed(0) })}
          </span>
        )}
        {hasContent && (
          <ChevronRight
            className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {isOpen && hasContent && (
        <div className="mt-1 rounded-lg border border-border/30 bg-muted/20 px-4 py-3">
          <div className={`prose dark:prose-invert prose-sm max-w-none text-muted-foreground wrap-break-word ${CHAT_PROSE_EDGE_CLASS}`}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});
