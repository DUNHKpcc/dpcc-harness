import { describe, expect, it } from "vitest";
import { formatAcpOperationError } from "../acp-utils";

describe("formatAcpOperationError", () => {
  it("keeps structured stage and code in the user-safe message", () => {
    expect(formatAcpOperationError({
      error: "generic failure",
      errorDetails: {
        code: "pi_missing",
        message: "Pi CLI was not found.",
        source: "pi",
        stage: "spawn",
        retryable: false,
      },
    }, "fallback")).toBe("[spawn/pi_missing] Pi CLI was not found.");
  });

  it("falls back to the legacy error string when details are unavailable", () => {
    expect(formatAcpOperationError({ error: "legacy failure" }, "fallback"))
      .toBe("legacy failure");
  });

  it("does not render malformed structured details as undefined metadata", () => {
    expect(formatAcpOperationError({
      error: "safe fallback",
      errorDetails: { message: "incomplete" },
    }, "fallback")).toBe("safe fallback");
  });
});
