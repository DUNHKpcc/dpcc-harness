/**
 * Returns true only when text matches known session/resume failure patterns.
 * Used to decide whether a failed resumed run means the stored resume id is
 * dead (and should be dropped) vs. a transient/unrelated error (keep it).
 * Ported from the reference bridge's `isSessionError`.
 */
const SESSION_ERROR_RE =
  /session.*not.*(found|exist)|no.*(valid|previous).*session|invalid.*session|session.*(invalid|expired|not.*found)|cannot.*resume|resume.*(fail|not.*found)/i;

export function isSessionError(text: string): boolean {
  return SESSION_ERROR_RE.test(text);
}
