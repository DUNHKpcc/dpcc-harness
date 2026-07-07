import { useMemo, useState } from "react";
import { ChevronRight, MessagesSquare, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ChatSession, InstalledAgent } from "@/types";
import { CHAT_MODULE_PROJECT_ID } from "@/lib/session/chat-module";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";

export function ChatSection({
  sessions,
  activeSessionId,
  islandLayout,
  agents,
  onCreateChat,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  islandLayout: boolean;
  agents?: InstalledAgent[];
  onCreateChat?: () => void;
}) {
  const { t } = useTranslation("sidebar");
  const { selectSession, deleteSession, renameSession, pinSession } = useSidebarActions();
  const [collapsed, setCollapsed] = useState(false);

  const chatSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.projectId === CHAT_MODULE_PROJECT_ID)
        .slice()
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [sessions],
  );

  return (
    <div className="mb-3">
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-start text-[13px] font-semibold text-sidebar-foreground/90 transition-all group-hover:pe-10 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform ${
              collapsed ? "" : "rotate-90"
            }`}
          />
          <MessagesSquare className="h-4 w-4 shrink-0 text-sidebar-foreground/65" />
          <span className="min-w-0 truncate">{t("chat.title")}</span>
          <span className="ms-auto shrink-0 ps-1 text-xs text-sidebar-foreground/40">
            {chatSessions.length}
          </span>
        </button>

        {onCreateChat && (
          <div className="absolute end-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-lg text-sidebar-foreground/50 transition-all hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/10"
              aria-label={t("topActions.newChat")}
              title={t("topActions.newChat")}
              onClick={onCreateChat}
            >
              <SquarePen className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="mt-0.5">
          {chatSessions.length === 0 ? (
            <div className="px-4 py-1.5 text-xs text-sidebar-foreground/45">
              {t("empty.noConversations")}
            </div>
          ) : (
            chatSessions.map((session) => (
              <SessionItem
                key={session.id}
                islandLayout={islandLayout}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => selectSession(session.id)}
                onDelete={() => deleteSession(session.id)}
                onRename={(title) => renameSession(session.id, title)}
                onPinToggle={() => pinSession(session.id, !session.pinned)}
                agents={agents}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
