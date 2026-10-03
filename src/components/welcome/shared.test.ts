import { describe, expect, it } from "vitest";
import enInput from "@/i18n/locales/en/input.json";
import zhInput from "@/i18n/locales/zh/input.json";
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
      expect(enInput.control.acpBehavior[id]).toBeTruthy();
      expect(zhInput.control.acpBehavior[id]).toBeTruthy();
      expect(enInput.control.acpBehavior[`${id}Desc`]).toBeTruthy();
      expect(zhInput.control.acpBehavior[`${id}Desc`]).toBeTruthy();
    }
  });
});
