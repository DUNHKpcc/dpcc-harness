import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface WindowPinButtonProps {
  alwaysOnTop: boolean;
  onToggle: () => void;
}

export const WindowPinButton = memo(function WindowPinButton({
  alwaysOnTop,
  onToggle,
}: WindowPinButtonProps) {
  const { t } = useTranslation("chat");
  const label = t(alwaysOnTop ? "header.unpinWindow" : "header.pinWindow");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`no-drag h-7 w-7 ${alwaysOnTop ? "text-primary hover:text-primary" : "text-muted-foreground/60 hover:text-foreground"}`}
          onClick={onToggle}
          aria-label={label}
          aria-pressed={alwaysOnTop}
        >
          {alwaysOnTop ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
});
