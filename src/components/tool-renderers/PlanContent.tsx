import { useTranslation } from "react-i18next";
import { Map } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@/types";
import { extractResultText } from "@/components/lib/tool-formatting";
import { GenericContent } from "./GenericContent";

const REMARK_PLUGINS = [remarkGfm];

// ── EnterPlanMode: subtle mode-transition indicator ──

export function EnterPlanModeContent({ message }: { message: UIMessage }) {
  const { t } = useTranslation("toolcall");
  const resultText = message.toolResult ? extractResultText(message.toolResult) : "";

  return (
    <div className="rounded-md bg-foreground/[0.03] px-3 py-2 text-xs text-foreground/50">
      {resultText || t("plan.enterPlaceholder")}
    </div>
  );
}

// ── ExitPlanMode: rendered plan markdown ──

export function ExitPlanModeContent({ message }: { message: UIMessage }) {
  const plan = String(message.toolInput?.plan ?? "");
  const filePath = String(message.toolInput?.filePath ?? "");
  const fileName = filePath ? filePath.split("/").pop() : null;

  if (!plan) return <GenericContent message={message} />;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header bar with plan file name */}
      {fileName && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-foreground/[0.04] border-b border-border/40">
          <Map className="h-3 w-3 text-foreground/40" />
          <span className="text-[11px] text-foreground/50 font-mono truncate">{fileName}</span>
        </div>
      )}

      {/* Plans should always render fully expanded. */}
      <div className="relative">
        <div className="px-4 py-3 prose dark:prose-invert prose-sm max-w-none text-foreground/80 text-[12.5px]">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{plan}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
