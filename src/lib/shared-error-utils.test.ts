import { describe, expect, it } from "vitest";
import { extractErrorDetails, extractErrorMessage, sanitizeErrorContext } from "@shared/lib/error-utils";

describe("shared error details", () => {
  it("redacts bearer credentials, token fields, and URL credentials", () => {
    const details = extractErrorDetails({
      message: "Authorization: Bearer bearer-secret access_token=token-secret https://user:password@example.com?api_key=key-secret",
    });

    expect(details.message).toContain("Bearer [REDACTED]");
    expect(details.message).toContain("access_token=[REDACTED]");
    expect(details.message).toContain("https://[REDACTED]@example.com");
    expect(details.message).toContain("api_key=[REDACTED]");
    expect(details.message).not.toMatch(/bearer-secret|token-secret|password|key-secret/);
  });

  it("falls back safely for circular objects", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(extractErrorMessage(value)).toContain("[Truncated]");
  });

  it("does not recurse forever when Error.cause points back to itself", () => {
    const error = new Error("outer failure") as Error & { cause?: unknown };
    error.cause = error;

    expect(extractErrorDetails(error)).toMatchObject({
      message: "outer failure",
      cause: "Circular error reference",
    });
  });

  it("preserves structured error codes from nested upstream errors", () => {
    expect(extractErrorDetails({
      response: {
        status: 502,
        data: {
          error: {
            message: "Pi upstream rejected the request",
            code: "pi_retry_exhausted",
          },
        },
      },
    })).toMatchObject({
      message: "Pi upstream rejected the request",
      code: "pi_retry_exhausted",
      status: 502,
    });

    expect(extractErrorDetails(Object.assign(new Error("transport failed"), { code: 503 }))).toMatchObject({
      message: "transport failed",
      code: 503,
    });
  });

  it("bounds and redacts diagnostic context without logging raw credentials", () => {
    const context = sanitizeErrorContext({
      apiKey: "key-secret",
      url: "https://example.com/callback?token=url-secret",
      nested: { authorization: "Bearer header-secret", detail: "safe" },
    });

    expect(context).toEqual({
      apiKey: "[REDACTED]",
      url: "https://example.com/callback?token=[REDACTED]",
      nested: { authorization: "[REDACTED]", detail: "safe" },
    });
    expect(JSON.stringify(context)).not.toMatch(/key-secret|url-secret|header-secret/);
  });

  it("redacts credential fields in object fallback messages", () => {
    const details = extractErrorDetails({
      apiKey: "object-key-secret",
      nested: {
        authorization: "Bearer object-header-secret",
        detail: "request setup failed",
      },
    });

    expect(details.message).toContain("request setup failed");
    expect(details.message).toContain("[REDACTED]");
    expect(details.message).not.toMatch(/object-key-secret|object-header-secret/);
  });
});
