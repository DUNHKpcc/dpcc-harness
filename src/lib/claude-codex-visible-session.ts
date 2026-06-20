/**
 * Helpers for the visible Codex split pane that Claude opens via `codex_delegate`.
 *
 * `buildDelegatedCodexSession` constructs the `ChatSession` record for the
 * delegated Codex pane; `extractCodexDelegationFinalText` distills the Codex
 * transcript down to the single final reply that is returned to Claude's
 * blocking MCP tool call.
 */
import type { ChatSession, Project, UIMessage } from "@/types";
import type { TurnStatus } from "@shared/types/codex-protocol/v2/TurnStatus";

const DELEGATED_CODEX_TITLE = "Codex delegated task";
const NO_FINAL_TEXT_FALLBACK = "Codex completed without a final assistant message.";

export interface BuildDelegatedCodexSessionInput {
  id: string;
  projectId: string;
  model?: string;
  delegatedFromSessionId: string;
  now: number;
}

export function buildDelegatedCodexSession(input: BuildDelegatedCodexSessionInput): ChatSession {
  return {
    id: input.id,
    projectId: input.projectId,
    title: DELEGATED_CODEX_TITLE,
    createdAt: input.now,
    lastMessageAt: input.now,
    model: input.model,
    totalCost: 0,
    engine: "codex",
    agentId: "codex",
    delegatedFromSessionId: input.delegatedFromSessionId,
    isActive: false,
  };
}

/**
 * Return the most recent assistant message text from a Codex transcript, used
 * as the delegated turn result handed back to Claude. Falls back to a fixed
 * message when the transcript holds no assistant text.
 */
export function extractCodexDelegationFinalText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return message.content;
    }
  }
  return NO_FINAL_TEXT_FALLBACK;
}

export interface CodexDelegationRequestLike {
  id: string;
  prompt: string;
  cwd?: string;
  claudeSessionId?: string;
}

export interface ResolveCodexDelegationRuntimeInput {
  request: CodexDelegationRequestLike;
  activeSessionId: string | null;
  activeSessionProjectId: string | null;
  activeProjectId: string | null;
  activeSpaceProjectId: string | null;
  sessions: ChatSession[];
  projects: Project[];
}

export interface CodexDelegationRuntime {
  claudeSessionId: string | null;
  projectId: string | null;
  cwd?: string;
}

function normalizeFsPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function projectContainsCwd(project: Project, cwd: string): boolean {
  const projectPath = normalizeFsPath(project.path);
  const requestedCwd = normalizeFsPath(cwd);
  return requestedCwd === projectPath || requestedCwd.startsWith(`${projectPath}/`);
}

function isClaudeLikeSession(session: ChatSession): boolean {
  return session.engine === undefined || session.engine === "claude";
}

/**
 * Resolve the parent Claude session and project for a bridge request without
 * relying on whichever session happens to be focused when the renderer receives
 * the IPC event.
 */
export function resolveCodexDelegationRuntime(input: ResolveCodexDelegationRuntimeInput): CodexDelegationRuntime {
  const requestedParent = input.request.claudeSessionId
    ? input.sessions.find((session) => session.id === input.request.claudeSessionId && isClaudeLikeSession(session))
    : undefined;
  const activeParent = input.activeSessionId
    ? input.sessions.find((session) => session.id === input.activeSessionId && isClaudeLikeSession(session))
    : undefined;
  const parent = requestedParent ?? activeParent;
  const cwdProject = input.request.cwd
    ? input.projects.find((project) => projectContainsCwd(project, input.request.cwd!))
    : undefined;

  return {
    claudeSessionId: parent?.id ?? null,
    projectId: cwdProject?.id
      ?? parent?.projectId
      ?? input.activeSessionProjectId
      ?? input.activeProjectId
      ?? input.activeSpaceProjectId
      ?? null,
    ...(cwdProject && input.request.cwd ? { cwd: input.request.cwd } : {}),
  };
}

export interface BuildCodexDelegationCompletionInput {
  bridgeRequestId: string;
  codexSessionId: string;
  status: TurnStatus;
  errorMessage?: string;
  messages: UIMessage[];
}

export interface CodexDelegationCompletion {
  id: string;
  ok: boolean;
  content: string;
  codexSessionId?: string;
  error?: string;
}

export function buildCodexDelegationCompletion(
  input: BuildCodexDelegationCompletionInput,
): CodexDelegationCompletion {
  if (input.status === "completed") {
    return {
      id: input.bridgeRequestId,
      ok: true,
      content: extractCodexDelegationFinalText(input.messages),
      codexSessionId: input.codexSessionId,
    };
  }

  return {
    id: input.bridgeRequestId,
    ok: false,
    content: "",
    error: input.errorMessage
      ?? (input.status === "interrupted" ? "Codex delegation was interrupted." : "Codex delegation did not complete."),
  };
}
