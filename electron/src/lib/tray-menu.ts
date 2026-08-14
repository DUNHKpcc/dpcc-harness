import type { SessionMeta } from "@shared/lib/session-persistence";

const CHAT_MODULE_PROJECT_ID = "__harnss_chat__";
const ENGINE_LABELS: Record<NonNullable<SessionMeta["engine"]>, string> = {
  claude: "Claude",
  codex: "Codex",
  acp: "ACP",
};

export function getSessionEngineLabel(engine: SessionMeta["engine"]): string {
  return ENGINE_LABELS[engine ?? "claude"];
}

export function formatTraySessionTitle(
  title: string,
  fallback = "Untitled",
  maxLength = 72,
): string {
  const normalized = title.replace(/\s+/g, " ").trim() || fallback;
  const safeMaxLength = Math.max(1, Math.floor(maxLength));
  return normalized.length > safeMaxLength
    ? `${normalized.slice(0, Math.max(1, safeMaxLength - 1)).trimEnd()}…`
    : normalized;
}

export function selectRecentTraySessions(
  sessions: SessionMeta[],
  limit = 3,
): SessionMeta[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  return sessions
    .filter((session) =>
      typeof session.id === "string" &&
      session.id.length > 0 &&
      typeof session.projectId === "string" &&
      session.projectId.length > 0,
    )
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, safeLimit);
}

export function formatTraySessionLabel(
  session: Pick<SessionMeta, "engine" | "projectId" | "title">,
  maxLength = 72,
): string {
  const engineLabel = getSessionEngineLabel(session.engine);
  const scope = session.projectId === CHAT_MODULE_PROJECT_ID
    ? `Chat · ${engineLabel}`
    : engineLabel;
  const prefix = `${scope} · `;
  const available = Math.max(1, maxLength - prefix.length);
  const title = formatTraySessionTitle(session.title, "Untitled", available);

  // Native Windows menus treat ampersands as mnemonic markers.
  return `${prefix}${title}`.replace(/&/g, "&&");
}
