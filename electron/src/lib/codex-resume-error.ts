import { extractErrorMessage } from "./error-utils";

const MISSING_ROLLOUT_RE = /\bno rollout found for thread id\b/i;

export function isMissingCodexRolloutError(err: unknown): boolean {
  return MISSING_ROLLOUT_RE.test(extractErrorMessage(err));
}

export function formatCodexResumeError(err: unknown, threadId: string): string {
  if (!isMissingCodexRolloutError(err)) {
    return extractErrorMessage(err);
  }

  return [
    "Codex local history for this chat is missing.",
    `The saved thread id ${threadId} no longer has a rollout file on this machine.`,
    "Start a new Codex chat to continue.",
  ].join(" ");
}
