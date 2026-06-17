import { useTranslation } from "react-i18next";
import {
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { FileItem } from "./FileItem";
import { InlineDiff } from "./InlineDiff";
import type { GitFileChange, GitFileGroup } from "@/types";

const SECTION_ACCENT: Record<GitFileGroup, string> = {
  staged: "bg-emerald-400",
  unstaged: "bg-amber-400",
  untracked: "bg-foreground/30",
};

export interface ChangesSectionProps {
  label: string;
  count: number;
  group: GitFileGroup;
  files: GitFileChange[];
  expanded: boolean;
  onToggle: () => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onStage?: (file: GitFileChange) => void;
  onUnstage?: (file: GitFileChange) => void;
  onDiscard?: (file: GitFileChange) => void;
  onViewDiff?: (file: GitFileChange) => void;
  expandedDiff: string | null;
  diffContent: string | null;
}

export function ChangesSection({
  label, count, group, files, expanded, onToggle,
  onStageAll, onUnstageAll, onStage, onUnstage, onDiscard, onViewDiff,
  expandedDiff, diffContent,
}: ChangesSectionProps) {
  const { t } = useTranslation("git");
  const accentDot = SECTION_ACCENT[group] ?? "bg-foreground/30";

  return (
    <div className="mt-px">
      <div className="group flex items-center gap-1.5 ps-3 pe-1.5 py-0.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-foreground/40" />
          )}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accentDot}`} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50">{label}</span>
          <span className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[9px] font-semibold tabular-nums text-foreground/45">{count}</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onStageAll && (
            <button type="button" onClick={onStageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300 cursor-pointer transition-colors" title={t("section.stageAll")}>
              <Plus className="h-3 w-3" />
            </button>
          )}
          {onUnstageAll && (
            <button type="button" onClick={onUnstageAll} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-300 cursor-pointer transition-colors" title={t("section.unstageAll")}>
              <Minus className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="pb-0.5">
          {files.map((file) => {
            const diffKey = `${group}:${file.path}`;
            const isExpanded = expandedDiff === diffKey;
            return (
              <div key={file.path}>
                <FileItem file={file} onStage={onStage} onUnstage={onUnstage} onDiscard={onDiscard} onViewDiff={onViewDiff} isExpanded={isExpanded} />
                {isExpanded && diffContent !== null && <InlineDiff diff={diffContent} />}
                {isExpanded && diffContent === null && (
                  <div className="flex items-center justify-center py-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-foreground/25" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
