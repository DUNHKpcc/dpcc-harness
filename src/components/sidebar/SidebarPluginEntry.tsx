import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react";

export const SidebarPluginEntry = memo(function SidebarPluginEntry() {
  const { t } = useTranslation("sidebar");

  return (
    <div className="no-drag relative">
      <button
        type="button"
        data-sidebar-plugin-entry="true"
        className="flex h-8 w-full items-center gap-2.5 rounded-md px-3.5 text-start text-[14px] font-medium text-sidebar-foreground/82 transition-colors hover:bg-sidebar-accent/55"
        aria-label={t("plugins.open")}
      >
        <Puzzle className="h-4.5 w-4.5 shrink-0 stroke-[1.8] text-sidebar-foreground/75" />
        <span>{t("plugins.open")}</span>
      </button>
    </div>
  );
});
