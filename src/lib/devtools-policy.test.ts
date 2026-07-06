import { describe, expect, it } from "vitest";
import { shouldShowBrowserDevTools } from "./devtools-policy";

describe("renderer DevTools policy", () => {
  it("hides Browser webview DevTools entry points in production builds", () => {
    expect(shouldShowBrowserDevTools(false)).toBe(false);
  });

  it("keeps Browser webview DevTools available in development", () => {
    expect(shouldShowBrowserDevTools(true)).toBe(true);
  });
});
