import { describe, expect, it } from "vitest";
import { getUpdateInstallErrorMessage, type UpdateInstallError } from "../UpdateBanner";

describe("getUpdateInstallErrorMessage", () => {
  const t = (key: string) => `translated:${key}`;

  it("localizes known install error codes instead of displaying main-process English", () => {
    const error: UpdateInstallError = {
      code: "manual-install-failed",
      message: "Automatic install failed. The download page has been opened — please install manually.",
    };

    expect(getUpdateInstallErrorMessage(error, t)).toBe(
      "translated:updateBanner.installErrors.manualInstallFailed",
    );
  });

  it("uses the generic localized install failure for unknown errors", () => {
    expect(getUpdateInstallErrorMessage({ message: "Some English error" }, t)).toBe(
      "translated:updateBanner.installFailed",
    );
  });
});
