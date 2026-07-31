import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react";

interface SidebarPluginEntryProps {
  active: boolean;
  onOpen: () => void;
}

export const SidebarPluginEntry = memo(function SidebarPluginEntry({
  active,
  onOpen,
}: SidebarPluginEntryProps) {
  const { t } = useTranslation("sidebar");

  return (
    <div className="no-drag relative">
      <button
        type="button"
        data-sidebar-plugin-entry="true"
        className={`flex h-8 w-full items-center gap-2.5 rounded-md px-3.5 text-start text-[14px] font-medium transition-colors ${
          active
            ? "bg-sidebar-accent/70 text-sidebar-foreground"
            : "text-sidebar-foreground/82 hover:bg-sidebar-accent/55"
        }`}
        aria-label={t("plugins.open")}
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
      >
        <Puzzle className="h-4.5 w-4.5 shrink-0 stroke-[1.8] text-sidebar-foreground/75" />
        <span>{t("plugins.open")}</span>
      </button>
    </div>
  );
});
