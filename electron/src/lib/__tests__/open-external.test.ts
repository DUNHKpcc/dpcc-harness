import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenExternal, mockReportError } = vi.hoisted(() => ({
  mockOpenExternal: vi.fn(),
  mockReportError: vi.fn((_label: string, err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: mockOpenExternal,
  },
}));

vi.mock("../error-utils", () => ({
  reportError: mockReportError,
}));

import { normalizeExternalUrl, openExternalUrl } from "../open-external";

beforeEach(() => {
  mockOpenExternal.mockReset();
  mockReportError.mockClear();
});

describe("normalizeExternalUrl", () => {
  it("allows http, https, and mailto external URLs by default", () => {
    expect(normalizeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeExternalUrl("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeExternalUrl("mailto:support@example.com")).toBe("mailto:support@example.com");
  });

  it("rejects executable, script, local file, and malformed URLs", () => {
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("file:///Applications/PccAgent.app")).toBeNull();
    expect(normalizeExternalUrl("vscode://file/tmp/project")).toBeNull();
    expect(normalizeExternalUrl("not a url")).toBeNull();
  });
});

describe("openExternalUrl", () => {
  it("returns an error instead of leaking openExternal rejections", async () => {
    mockOpenExternal.mockRejectedValue(new Error("no default browser"));

    await expect(openExternalUrl("https://example.com")).resolves.toEqual({
      ok: false,
      error: "no default browser",
    });
    expect(mockReportError).toHaveBeenCalledWith(
      "OPEN_EXTERNAL_ERR",
      expect.any(Error),
      { url: "https://example.com/" },
    );
  });
});
