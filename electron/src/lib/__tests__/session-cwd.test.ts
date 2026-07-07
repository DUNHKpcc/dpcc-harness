import { describe, expect, it } from "vitest";
import { normalizeSessionCwd } from "../session-cwd";

describe("normalizeSessionCwd", () => {
  it("uses the fallback directory for missing or blank cwd values", () => {
    expect(normalizeSessionCwd(undefined, "/Users/tester")).toBe("/Users/tester");
    expect(normalizeSessionCwd(null, "/Users/tester")).toBe("/Users/tester");
    expect(normalizeSessionCwd("", "/Users/tester")).toBe("/Users/tester");
    expect(normalizeSessionCwd("   ", "/Users/tester")).toBe("/Users/tester");
  });

  it("trims explicit cwd values", () => {
    expect(normalizeSessionCwd("  /repo/project  ", "/Users/tester")).toBe("/repo/project");
  });
});
