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

export function isAccountCredentialRejection(value: unknown): boolean {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.status === 401 || record.statusCode === 401 || record.status_code === 401) {
      return true;
    }
  }
  const text = rejectionText(value);
  if (!text) return false;
  return (
    /\b(?:http(?:\/\d(?:\.\d)?)?\s*)?401\b/i.test(text)
    || /\bunauthori[sz]ed\b/i.test(text)
    || /\bauthentication[_\s-]*(?:error|failed|required)\b/i.test(text)
    || /\b(?:invalid|revoked|expired)[_\s-]*(?:x[_\s-]*)?(?:api[_\s-]*key|access[_\s-]*token|bearer[_\s-]*token|credential)\b/i.test(text)
    || /\b(?:x[_\s-]*)?(?:api[_\s-]*key|access[_\s-]*token|bearer[_\s-]*token|credential)[_\s-]*(?:is[_\s-]*)?(?:invalid|revoked|expired)\b/i.test(text)
  );
}
