/**
 * SplitDropZone — animated dashed drop target for drag-to-split.
 *
 * Renders a vertical dashed-border region at a specific position in the
 * split pane layout. Animates in when a session is being dragged from
 * the sidebar, showing where the new pane would be inserted.
 */

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import type { ChatSession } from "@/types";

interface SplitDropZoneProps {
  /** Whether a drop zone is being shown. */
  active: boolean;
  /** Session being dragged (for preview label). */
  session?: ChatSession | null;
  /** Custom label for non-session previews. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}

export const SplitDropZone = memo(function SplitDropZone({
  active,
  session,
  label,
  className,
  style,
  onDragOver,
  onDrop,
}: SplitDropZoneProps) {
  const { t } = useTranslation("workspace");
  if (!active) return null;

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.65 }}
      className={`flex shrink-0 items-center justify-center rounded-[var(--island-radius)] border-2 border-dashed border-primary/30 bg-primary/[0.03] transition-all duration-200 ${className ?? ""}`}
      style={style}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex flex-col items-center gap-2 text-primary/40">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Plus className="h-4 w-4" />
        </div>
        <span className="max-w-[160px] truncate text-xs font-medium">
          {label ?? session?.title ?? t("split.dropToOpen")}
        </span>
      </div>
    </motion.div>
  );
});
