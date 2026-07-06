import type { Project } from "@/types";

export const CHAT_MODULE_PROJECT_ID = "__harnss_chat__";
export const CHAT_MODULE_PROJECT_NAME = "Chat";
export const CHAT_MODULE_PROJECT_PATH = "";

export function isChatModuleProjectId(projectId: string | null | undefined): boolean {
  return projectId === CHAT_MODULE_PROJECT_ID;
}

export function getChatModuleProject(): Project {
  return {
    id: CHAT_MODULE_PROJECT_ID,
    name: CHAT_MODULE_PROJECT_NAME,
    path: CHAT_MODULE_PROJECT_PATH,
    createdAt: 0,
    icon: "MessagesSquare",
    iconType: "lucide",
  };
}

export function withChatModuleProjectIds(projectIds: string[]): string[] {
  return [
    CHAT_MODULE_PROJECT_ID,
    ...projectIds.filter((projectId) => projectId !== CHAT_MODULE_PROJECT_ID),
  ];
}
