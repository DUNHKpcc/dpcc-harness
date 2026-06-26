import type { AskForApproval } from "../types/codex-protocol/v2/AskForApproval";
import type { SandboxMode } from "../types/codex-protocol/v2/SandboxMode";
import type { SandboxPolicy } from "../types/codex-protocol/v2/SandboxPolicy";

export const DEFAULT_APP_PERMISSION_MODE = "default";

export interface CodexPermissionOptions {
  approvalPolicy?: AskForApproval;
  sandbox?: SandboxMode;
}

export function normalizeAppPermissionMode(mode: string | undefined): string {
  const normalized = mode?.trim();
  if (!normalized || normalized === "plan") return DEFAULT_APP_PERMISSION_MODE;
  return normalized;
}

export function codexPermissionOptionsFromMode(mode: string | undefined): CodexPermissionOptions {
  switch (normalizeAppPermissionMode(mode)) {
    case "default":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      };
    case "acceptEdits":
      return {
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
      };
    case "bypassPermissions":
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      };
    default:
      return {};
  }
}

export function codexSandboxPolicyFromMode(
  mode: string | undefined,
  cwd: string | undefined,
): SandboxPolicy | undefined {
  const { sandbox } = codexPermissionOptionsFromMode(mode);
  if (sandbox === "danger-full-access") {
    return { type: "dangerFullAccess" };
  }
  if (sandbox === "workspace-write") {
    return {
      type: "workspaceWrite",
      writableRoots: cwd ? [cwd] : [],
      readOnlyAccess: { type: "fullAccess" },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }
  if (sandbox === "read-only") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
    };
  }
  return undefined;
}
