import { describe, expect, it } from "vitest";
import enWelcome from "@/i18n/locales/en/welcome.json";
import zhWelcome from "@/i18n/locales/zh/welcome.json";
import { PERMISSION_MODES } from "./shared";

describe("welcome ACP permission contract", () => {
  it("offers only permission behaviors understood by the ACP runtime", () => {
    expect(PERMISSION_MODES.map((mode) => mode.id)).toEqual([
      "ask",
      "auto_accept",
      "allow_all",
    ]);
    expect(PERMISSION_MODES.map((mode) => mode.id)).not.toEqual(expect.arrayContaining([
      "default",
      "plan",
      "bypassPermissions",
    ]));
  });

  it("keeps every ACP permission behavior localized", () => {
    for (const { id } of PERMISSION_MODES) {
      expect(enWelcome.permissionsStep.modes[id].label).toBeTruthy();
      expect(enWelcome.permissionsStep.modes[id].description).toBeTruthy();
      expect(zhWelcome.permissionsStep.modes[id].label).toBeTruthy();
      expect(zhWelcome.permissionsStep.modes[id].description).toBeTruthy();
    }
  });
});
