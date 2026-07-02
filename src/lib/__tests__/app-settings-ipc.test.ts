import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSettingsSetOk,
  isSettingsSetFailure,
  setAppSettingsChecked,
} from "../app-settings-ipc";

function stubSettingsSet(result: unknown) {
  const set = vi.fn().mockResolvedValue(result);
  vi.stubGlobal("window", {
    claude: {
      settings: { set },
    },
  });
  return set;
}

describe("app settings IPC helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects settings:set error responses", () => {
    expect(isSettingsSetFailure({ error: "disk write failed" })).toBe(true);
    expect(isSettingsSetFailure({ ok: true })).toBe(false);
    expect(isSettingsSetFailure(null)).toBe(false);
  });

  it("throws when settings:set returns an error", () => {
    expect(() => assertSettingsSetOk({ error: "disk write failed" })).toThrow("disk write failed");
    expect(() => assertSettingsSetOk({ ok: true })).not.toThrow();
  });

  it("wraps successful settings:set calls", async () => {
    const set = stubSettingsSet({ ok: true });

    await expect(setAppSettingsChecked({ analyticsEnabled: false })).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith({ analyticsEnabled: false });
  });

  it("wraps failed settings:set calls as thrown errors", async () => {
    stubSettingsSet({ error: "disk write failed" });

    await expect(setAppSettingsChecked({ analyticsEnabled: false })).rejects.toThrow("disk write failed");
  });
});
