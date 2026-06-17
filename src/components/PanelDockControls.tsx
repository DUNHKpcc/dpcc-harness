import { memo } from "react";
import { ArrowDown, ArrowRight, GripHorizontal, X, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PanelDockControlsProps {
  isBottom: boolean;
  onMovePlacement: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onClose?: () => void;
  moveLabel?: string;
  closeLabel?: string;
  moveIcon?: LucideIcon;
}

export const PanelDockControls = memo(function PanelDockControls({
  isBottom,
  onMovePlacement,
  onDragStart,
  onDragEnd,
  onClose,
  moveLabel,
  closeLabel,
  moveIcon,
}: PanelDockControlsProps) {
  const MoveIcon = moveIcon ?? (isBottom ? ArrowRight : ArrowDown);
  const resolvedMoveLabel = moveLabel ?? (isBottom ? "Move to side" : "Move to bottom");
  const resolvedCloseLabel = closeLabel ?? "Close panel";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onMovePlacement}
            className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/55"
          >
            <MoveIcon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>
          <p className="text-xs font-medium">{resolvedMoveLabel}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="flex h-5 w-8 cursor-grab items-center justify-center rounded-md text-foreground/25 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/55 active:cursor-grabbing"
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={8}>
          <p className="text-xs font-medium">Drag to dock</p>
        </TooltipContent>
      </Tooltip>
      {onClose && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded-md text-foreground/25 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/55"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            <p className="text-xs font-medium">{resolvedCloseLabel}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
});
