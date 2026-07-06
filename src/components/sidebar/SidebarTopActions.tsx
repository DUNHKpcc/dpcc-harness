import { memo } from "react";
import { useTranslation } from "react-i18next";
import { SquarePen } from "lucide-react";
import { SidebarSearch } from "@/components/SidebarSearch";
import { SidebarPluginEntry } from "./SidebarPluginEntry";

interface SidebarTopActionsProps {
  projectIds: string[];
  onCreateChat: () => void;
  onNavigateToMessage: (sessionId: string, messageId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onOpenMcpPanel?: () => void;
}

export const SidebarTopActions = memo(function SidebarTopActions({
  projectIds,
  onCreateChat,
  onNavigateToMessage,
  onSelectSession,
  onOpenMcpPanel,
}: SidebarTopActionsProps) {
  const { t } = useTranslation("sidebar");

  return (
    <div data-sidebar-top-actions="true" className="no-drag shrink-0 px-3 pb-4 pt-2">
      <div className="space-y-1">
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-3.5 text-start text-[14px] font-medium text-sidebar-foreground/82 transition-colors hover:bg-sidebar-accent/55"
          onClick={onCreateChat}
        >
          <SquarePen className="h-4.5 w-4.5 shrink-0 stroke-[1.8] text-sidebar-foreground/75" />
          <span>{t("topActions.newChat")}</span>
        </button>

        <SidebarSearch
          variant="row"
          projectIds={projectIds}
          onNavigateToMessage={onNavigateToMessage}
          onSelectSession={onSelectSession}
        />

        <SidebarPluginEntry onOpenMcpPanel={onOpenMcpPanel} />
      </div>
    </div>
  );
});
