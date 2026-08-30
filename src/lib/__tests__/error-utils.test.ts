import { describe, expect, it } from "vitest";
import { extractErrorDetails, extractErrorMessage } from "@shared/lib/error-utils";

describe("extractErrorDetails", () => {
  it("keeps useful Error metadata and its cause", () => {
    const error = Object.assign(new Error("request failed"), {
      code: "ECONNRESET",
      status: 502,
      cause: new Error("socket closed"),
    });

    expect(extractErrorDetails(error)).toMatchObject({
      message: "request failed",
      code: "ECONNRESET",
      status: 502,
      cause: "socket closed",
    });
  });

  it("understands nested API and child-process error shapes", () => {
    expect(extractErrorDetails({
      response: { status: 401, data: { error: { message: "upstream rejected" } } },
    })).toMatchObject({ message: "upstream rejected", status: 401 });

    expect(extractErrorMessage({ stderr: "Pi connection failed" })).toBe("Pi connection failed");
  });

  it("does not return credentials or unbounded payloads", () => {
    const message = extractErrorMessage({
      message: "Authorization=Bearer secret-value token=another-secret",
      payload: "x".repeat(10_000),
    });

    expect(message).toContain("Authorization=Bearer [REDACTED]");
    expect(message).not.toContain("secret-value");
    expect(message.length).toBeLessThanOrEqual(2_003);
  });

  it("survives circular unknown values", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(extractErrorMessage(value)).toContain("[Truncated]");
  });
});
