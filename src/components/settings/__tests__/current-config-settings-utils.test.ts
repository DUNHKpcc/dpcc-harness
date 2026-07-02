import { describe, expect, it } from "vitest";
import {
  shouldApplyConfigSourceRefresh,
} from "../current-config-settings-utils";

describe("current config settings utilities", () => {
  it("ignores stale config source refreshes from older requests", () => {
    expect(shouldApplyConfigSourceRefresh(2, 2)).toBe(true);
    expect(shouldApplyConfigSourceRefresh(1, 2)).toBe(false);
  });
});
