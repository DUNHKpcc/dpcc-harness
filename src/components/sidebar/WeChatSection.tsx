import { useMemo, useState } from "react";
import { ChevronRight, Smartphone } from "lucide-react";
import type { ChatSession, InstalledAgent, Project } from "@/types";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";

/**
 * Dedicated sidebar area for conversations that originated from the WeChat
 * bridge (`source === "wechat"`). Spans all projects (WeChat conversations are
 * bound to a project regardless of the active space) and groups them by project,
 * mirroring how the main list organizes chats.
 */
export function WeChatSection({
  sessions,
  projects,
  activeSessionId,
  islandLayout,
  agents,
}: {
  sessions: ChatSession[];
  projects: Project[];
  activeSessionId: string | null;
  islandLayout: boolean;
  agents?: InstalledAgent[];
}) {
  const { selectSession, deleteSession, renameSession } = useSidebarActions();
  const [collapsed, setCollapsed] = useState(false);

  const groups = useMemo(() => {
    const wechat = sessions.filter((s) => s.source === "wechat");
    if (wechat.length === 0) return [];
    const nameById = new Map(projects.map((p) => [p.id, p.name]));
    const byProject = new Map<string, ChatSession[]>();
    for (const s of wechat) {
      const arr = byProject.get(s.projectId) ?? [];
      arr.push(s);
      byProject.set(s.projectId, arr);
    }
    return [...byProject.entries()].map(([projectId, list]) => ({
      projectId,
      name: nameById.get(projectId) ?? "微信",
      sessions: list
        .slice()
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    }));
  }, [sessions, projects]);

  if (groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.sessions.length, 0);
  const showProjectHeaders = groups.length > 1;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-start text-[13px] font-semibold text-sidebar-foreground/90 transition-all hover:bg-black/5 dark:hover:bg-white/10"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-sidebar-foreground/50 transition-transform ${
            collapsed ? "" : "rotate-90"
          }`}
        />
        <Smartphone className="h-4 w-4 shrink-0 text-green-500" />
        <span className="min-w-0 truncate">微信</span>
        <span className="ms-auto shrink-0 ps-1 text-xs text-sidebar-foreground/40">{total}</span>
      </button>

      {!collapsed && (
        <div className="mt-0.5">
          {groups.map((group) => (
            <div key={group.projectId} className="mb-1">
              {showProjectHeaders && (
                <div className="px-2.5 py-0.5 text-[11px] font-medium text-sidebar-foreground/50 wrap-break-word">
                  {group.name}
                </div>
              )}
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  islandLayout={islandLayout}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => selectSession(session.id)}
                  onDelete={() => deleteSession(session.id)}
                  onRename={(title) => renameSession(session.id, title)}
                  agents={agents}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
