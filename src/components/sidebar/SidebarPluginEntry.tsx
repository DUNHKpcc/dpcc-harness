import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plug, Puzzle, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SidebarPluginEntryProps {
  onOpenMcpPanel?: () => void;
}

export function SidebarPluginMenuContent({ onOpenMcpPanel }: SidebarPluginEntryProps) {
  const { t } = useTranslation("sidebar");

  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-popover-foreground/90 transition-colors hover:bg-foreground/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
        aria-disabled="true"
        disabled
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
          <Sparkles className="h-3.5 w-3.5 text-amber-500/80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{t("plugins.skills")}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{t("plugins.skillsHint")}</span>
        </span>
        <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t("plugins.comingSoon")}
        </span>
      </button>

      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-popover-foreground/90 transition-colors hover:bg-foreground/[0.04]"
        onClick={onOpenMcpPanel}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
          <Plug className="h-3.5 w-3.5 text-violet-500/80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{t("plugins.mcp")}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{t("plugins.mcpHint")}</span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
      </button>
    </div>
  );
}

export const SidebarPluginEntry = memo(function SidebarPluginEntry({
  onOpenMcpPanel,
}: SidebarPluginEntryProps) {
  const { t } = useTranslation("sidebar");
  const [open, setOpen] = useState(false);

  return (
    <div className="no-drag relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-sidebar-plugin-entry="true"
            className="flex h-10 w-full items-center gap-3 rounded-md px-4 text-start text-[15px] font-medium text-sidebar-foreground/82 transition-colors hover:bg-sidebar-accent/55"
            aria-label={t("plugins.open")}
          >
            <Puzzle className="h-5 w-5 shrink-0 stroke-[1.8] text-sidebar-foreground/75" />
            <span>{t("plugins.open")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          className="w-64 p-1.5"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SidebarPluginMenuContent
            onOpenMcpPanel={() => {
              setOpen(false);
              onOpenMcpPanel?.();
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
