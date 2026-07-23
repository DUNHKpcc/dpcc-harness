import type { SessionMeta } from "@shared/lib/session-persistence";

const CHAT_MODULE_PROJECT_ID = "__harnss_chat__";
const ENGINE_LABELS: Record<NonNullable<SessionMeta["engine"]>, string> = {
  claude: "Claude",
  codex: "Codex",
  acp: "ACP",
};

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
  const engineLabel = ENGINE_LABELS[session.engine ?? "claude"];
  const scope = session.projectId === CHAT_MODULE_PROJECT_ID
    ? `Chat · ${engineLabel}`
    : engineLabel;
  const title = session.title.replace(/\s+/g, " ").trim() || "Untitled";
  const prefix = `${scope} · `;
  const available = Math.max(1, maxLength - prefix.length);
  const truncatedTitle = title.length > available
    ? `${title.slice(0, Math.max(1, available - 1)).trimEnd()}…`
    : title;

  // Native Windows menus treat ampersands as mnemonic markers.
  return `${prefix}${truncatedTitle}`.replace(/&/g, "&&");
}
