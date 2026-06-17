/**
 * Manages Jira board state per space.
 *
 * Tracks which Jira project is displayed as a board for each space,
 * handles task creation from Jira issues, and prunes stale entries.
 */

import { useCallback, useEffect, useState } from "react";
import type { JiraIssue } from "@shared/types/jira";

// ── Persistence ──

const JIRA_BOARD_BY_SPACE_KEY = "pcc-agent-jira-board-by-space";

function readJiraBoardBySpace(): Record<string, string> {
  try {
    const raw = localStorage.getItem(JIRA_BOARD_BY_SPACE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ── Types ──

interface Project {
  id: string;
  path: string;
  spaceId?: string;
  name?: string;
}

interface UseJiraBoardOptions {
  jiraBoardEnabled: boolean;
  activeSpaceId: string;
  activeProjectId: string | null | undefined;
  activeSessionId: string | null;
  projects: Project[];
  handleSend: (text: string) => void;
  handleNewChat: (projectId: string) => Promise<void>;
}

interface UseJiraBoardReturn {
  jiraBoardBySpace: Record<string, string>;
  jiraBoardProjectId: string | null;
  jiraBoardProject: Project | null;
  setJiraBoardProjectForSpace: (spaceId: string, projectId: string | null) => void;
  handleToggleProjectJiraBoard: (projectId: string) => void;
  handleCreateTaskFromJiraIssue: (projectId: string, issue: JiraIssue) => void;
  /** Pending Jira task that should trigger a send when conditions are met. */
  pendingJiraTask: { projectId: string; message: string } | null;
}

// ── Hook ──

export function useJiraBoard({
  jiraBoardEnabled,
  activeSpaceId,
  activeProjectId,
  activeSessionId,
  projects,
  handleSend,
  handleNewChat,
}: UseJiraBoardOptions): UseJiraBoardReturn {
  const [jiraBoardBySpace, setJiraBoardBySpace] = useState<Record<string, string>>(() => readJiraBoardBySpace());
  const [pendingJiraTask, setPendingJiraTask] = useState<{ projectId: string; message: string } | null>(null);

  const jiraBoardProjectId = jiraBoardEnabled
    ? (jiraBoardBySpace[activeSpaceId] ?? null)
    : null;
  const jiraBoardProject = jiraBoardProjectId
    ? projects.find((project) => project.id === jiraBoardProjectId) ?? null
    : null;

  const setJiraBoardProjectForSpace = useCallback((spaceId: string, projectId: string | null) => {
    setJiraBoardBySpace((prev) => {
      const next = { ...prev };
      if (projectId) {
        next[spaceId] = projectId;
      } else {
        delete next[spaceId];
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleToggleProjectJiraBoard = useCallback((projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const spaceId = project.spaceId || "default";
    const currentProjectId = jiraBoardBySpace[spaceId];
    setJiraBoardProjectForSpace(spaceId, currentProjectId === projectId ? null : projectId);
  }, [jiraBoardBySpace, projects, setJiraBoardProjectForSpace]);

  const handleCreateTaskFromJiraIssue = useCallback(
    (projectId: string, issue: JiraIssue) => {
      const taskMessage = `Please help me work on this Jira issue:

**${issue.key}: ${issue.summary}**

${issue.description ? `\n${issue.description}\n` : ""}
${issue.assignee ? `Assigned to: ${issue.assignee.displayName}\n` : ""}
Status: ${issue.status}
${issue.priority ? `Priority: ${issue.priority.name}\n` : ""}

Link: ${issue.url}`;

      const project = projects.find((item) => item.id === projectId);
      if (project) {
        setJiraBoardProjectForSpace(project.spaceId || "default", null);
      }

      if (activeProjectId === projectId && activeSessionId) {
        handleSend(taskMessage);
        return;
      }

      setPendingJiraTask({ projectId, message: taskMessage });
      void handleNewChat(projectId);
    },
    [activeProjectId, handleNewChat, handleSend, activeSessionId, projects, setJiraBoardProjectForSpace],
  );

  // Prune stale entries when projects change
  useEffect(() => {
    setJiraBoardBySpace((prev) => {
      let changed = false;
      const next: Record<string, string> = {};

      for (const [spaceId, projectId] of Object.entries(prev)) {
        const project = projects.find((item) => item.id === projectId);
        if (!project) {
          changed = true;
          continue;
        }
        const projectSpaceId = project.spaceId || "default";
        if (next[projectSpaceId] !== projectId) {
          next[projectSpaceId] = projectId;
        }
        if (projectSpaceId !== spaceId) {
          changed = true;
        }
      }

      if (!changed && Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      localStorage.setItem(JIRA_BOARD_BY_SPACE_KEY, JSON.stringify(next));
      return next;
    });
  }, [projects]);

  // Fire pending Jira task when the target session becomes active
  useEffect(() => {
    if (!pendingJiraTask) return;
    if (activeProjectId !== pendingJiraTask.projectId || !activeSessionId) return;
    setPendingJiraTask(null);
    handleSend(pendingJiraTask.message);
  }, [activeProjectId, handleSend, activeSessionId, pendingJiraTask]);

  // Clear board data when feature is disabled
  useEffect(() => {
    if (jiraBoardEnabled) return;
    setJiraBoardBySpace((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      localStorage.removeItem(JIRA_BOARD_BY_SPACE_KEY);
      return {};
    });
  }, [jiraBoardEnabled]);

  return {
    jiraBoardBySpace,
    jiraBoardProjectId,
    jiraBoardProject,
    setJiraBoardProjectForSpace,
    handleToggleProjectJiraBoard,
    handleCreateTaskFromJiraIssue,
    pendingJiraTask,
  };
}
