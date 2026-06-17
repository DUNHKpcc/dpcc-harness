import { useTranslation } from "react-i18next";
import {
  Plus,
  Minus,
  Undo2,
} from "lucide-react";
import { STATUS_COLORS, STATUS_LETTERS } from "./git-panel-utils";
import type { GitFileChange } from "@/types";

export function FileItem({
  file, onStage, onUnstage, onDiscard, onViewDiff, isExpanded,
}: {
  file: GitFileChange;
  onStage?: (f: GitFileChange) => void;
  onUnstage?: (f: GitFileChange) => void;
  onDiscard?: (f: GitFileChange) => void;
  onViewDiff?: (f: GitFileChange) => void;
  isExpanded: boolean;
}) {
  const { t } = useTranslation("git");
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  const statusColor = STATUS_COLORS[file.status] ?? "text-foreground/40 bg-foreground/[0.06]";
  const statusLetter = STATUS_LETTERS[file.status] ?? "?";

  return (
    <div className={`group flex items-center gap-1 pe-2 ps-5 py-[3px] text-[11px] transition-colors hover:bg-foreground/[0.04] ${isExpanded ? "bg-foreground/[0.05]" : ""}`}>
      {/* File name + path — clickable for diff */}
      <button
        type="button"
        onClick={() => onViewDiff?.(file)}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate cursor-pointer"
        disabled={!onViewDiff}
      >
        <span className="min-w-0 truncate text-foreground/75">{fileName}</span>
        {dirPath && (
          <span className="min-w-0 shrink truncate text-[10px] text-foreground/30">{dirPath}</span>
        )}
        {file.oldPath && (
          <span className="shrink-0 text-[10px] text-foreground/30">← {file.oldPath.split("/").pop()}</span>
        )}
      </button>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {onDiscard && (
          <button type="button" onClick={() => onDiscard(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300 cursor-pointer transition-colors" title={t("file.discard")}>
            <Undo2 className="h-2.5 w-2.5" />
          </button>
        )}
        {onStage && (
          <button type="button" onClick={() => onStage(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-300 cursor-pointer transition-colors" title={t("file.stage")}>
            <Plus className="h-3 w-3" />
          </button>
        )}
        {onUnstage && (
          <button type="button" onClick={() => onUnstage(file)} className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/30 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-300 cursor-pointer transition-colors" title={t("file.unstage")}>
            <Minus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Status badge */}
      <span className={`flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-bold ${statusColor}`}>
        {statusLetter}
      </span>
    </div>
  );
}
