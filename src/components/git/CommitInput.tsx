import { useState, useCallback, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineId } from "@/types";
import { DRAFT_ID } from "@/hooks/session/types";

export interface CommitInputProps {
  cwd: string;
  stagedCount: number;
  totalChanges: number;
  activeEngine?: EngineId;
  activeSessionId?: string | null;
  onSyncError: (error: string) => void;
  onCommit: (message: string) => Promise<void>;
}

export function CommitInput({
  cwd,
  stagedCount,
  totalChanges,
  activeEngine,
  activeSessionId,
  onSyncError,
  onCommit,
}: CommitInputProps) {
  const { t } = useTranslation("git");
  const [commitMessage, setCommitMessage] = useState("");
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const hasUsageOwner = !!activeSessionId && activeSessionId !== DRAFT_ID;

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedCount === 0) return;
    await onCommit(commitMessage.trim());
    setCommitMessage("");
  }, [commitMessage, stagedCount, onCommit]);

  const handleCommitKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleGenerateMessage = useCallback(async () => {
    if (!hasUsageOwner) return;
    setGeneratingMessage(true);
    try {
      const result = await window.claude.git.generateCommitMessage(
        cwd,
        activeEngine,
        activeSessionId ?? undefined,
      );
      if (result.message) {
        setCommitMessage(result.message);
      } else if (result.error) {
        onSyncError(result.error);
      } else {
        onSyncError(t("commit.noResultReceived"));
      }
    } finally {
      setGeneratingMessage(false);
    }
  }, [cwd, activeEngine, activeSessionId, hasUsageOwner, onSyncError, t]);

  const canCommit = commitMessage.trim().length > 0 && stagedCount > 0;

  return (
    <div className="mx-3 mb-1.5">
      <div className="overflow-hidden rounded-md border border-foreground/[0.08] bg-foreground/[0.02] transition-colors focus-within:border-foreground/[0.15] focus-within:bg-foreground/[0.04]">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          placeholder={t("commit.placeholder")}
          rows={2}
          className="w-full resize-none bg-transparent px-2.5 pt-1.5 pb-1 text-[11px] leading-relaxed text-foreground/80 outline-none placeholder:text-foreground/30"
        />
        {/* Action bar */}
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleGenerateMessage}
                disabled={generatingMessage || totalChanges === 0 || !hasUsageOwner}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-foreground/[0.08] bg-foreground/[0.03] text-foreground/40 transition-colors hover:border-foreground/[0.12] hover:bg-foreground/[0.06] hover:text-foreground/70 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
              >
                {generatingMessage ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">{t("commit.aiMessage")}</p>
            </TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1" />
          {stagedCount > 0 && (
            <span className="text-[10px] tabular-nums text-foreground/35">
              {t("commit.stagedCount", { n: stagedCount })}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCommit}
                disabled={!canCommit}
                className={`flex h-6 items-center gap-1 rounded-md px-2.5 text-[10px] font-medium transition-colors cursor-pointer ${
                  canCommit
                    ? "border border-foreground/[0.1] bg-foreground/[0.07] text-foreground/75 hover:bg-foreground/[0.12] hover:text-foreground"
                    : "text-foreground/20 cursor-not-allowed"
                }`}
              >
                <Check className="h-3 w-3" />
                <span>{t("commit.commit")}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">
                {t("commit.commitChanges")}
                <span className="ms-1.5 text-background/50">⌘↵</span>
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
