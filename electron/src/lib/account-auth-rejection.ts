function rejectionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return [
    record.message,
    record.error,
    record.additionalDetails,
    record.additional_details,
  ].filter((item): item is string => typeof item === "string").join(" ");
}

interface AccountCredentialRejectionOptions {
  allowGenericAuthStatus?: boolean;
}

export function isAccountCredentialRejection(
  value: unknown,
  options: AccountCredentialRejectionOptions = {},
): boolean {
  let hasStatus401 = false;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    hasStatus401 = record.status === 401 || record.statusCode === 401 || record.status_code === 401;
  }
  const text = rejectionText(value);
  if (!text) return options.allowGenericAuthStatus !== false && hasStatus401;
  // Codex may probe ChatGPT's plugin catalog even when its model traffic uses
  // the DPCC upstream. A failure from that optional service says nothing about
  // the desktop account credential and must not revoke it.
  if (
    /\bfailed to warm featured plugin ids cache\b/i.test(text)
    || /\/backend-api\/plugins\/featured(?:\?|\b)/i.test(text)
  ) {
    return false;
  }
  const hasExplicitCredentialFailure = (
    /\b(?:invalid|revoked|expired)[_\s-]*(?:x[_\s-]*)?(?:api[_\s-]*key|access[_\s-]*token|bearer[_\s-]*token|credential)\b/i.test(text)
    || /\b(?:x[_\s-]*)?(?:api[_\s-]*key|access[_\s-]*token|bearer[_\s-]*token|credential)[_\s-]*(?:is[_\s-]*)?(?:invalid|revoked|expired)\b/i.test(text)
  );
  if (hasExplicitCredentialFailure) return true;
  if (options.allowGenericAuthStatus === false) return false;
  return (
    hasStatus401
    || /\b(?:http(?:\/\d(?:\.\d)?)?\s*)?401\b/i.test(text)
    || /\bunauthori[sz]ed\b/i.test(text)
    || /\bauthentication[_\s-]*(?:error|failed|required)\b/i.test(text)
  );
}
