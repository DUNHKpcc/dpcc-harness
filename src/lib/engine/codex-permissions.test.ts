import { describe, expect, it } from "vitest";
import { codexPermissionOptionsFromMode, codexSandboxPolicyFromMode, normalizeAppPermissionMode } from "@shared/lib/codex-permissions";

describe("codex permission options", () => {
  it("maps app permission modes to Codex approval policy and sandbox", () => {
    expect(codexPermissionOptionsFromMode("default")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(codexPermissionOptionsFromMode("acceptEdits")).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
    expect(codexPermissionOptionsFromMode("bypassPermissions")).toEqual({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
  });

  it("normalizes legacy plan permission mode before configuring Codex", () => {
    expect(normalizeAppPermissionMode("plan")).toBe("default");
    expect(codexPermissionOptionsFromMode("plan")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
  });

  it("builds turn-level sandbox policies from app permission modes", () => {
    expect(codexSandboxPolicyFromMode("bypassPermissions", "/repo")).toEqual({
      type: "dangerFullAccess",
    });
    expect(codexSandboxPolicyFromMode("default", "/repo")).toEqual({
      type: "workspaceWrite",
      writableRoots: ["/repo"],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
  });
});
