import type { RegistryAgent, RegistryBinaryTarget, InstalledAgent } from "@/types";
import type { BinaryCheckResult } from "@/lib/engine/acp-agent-registry";

/**
 * Convert a registry agent to a local InstalledAgent.
 * Supports npx distribution (preferred), user-managed Pi ACP, and binary
 * distribution when a resolved system path is provided.
 */
export function registryAgentToDefinition(
  agent: RegistryAgent,
  binaryInfo?: BinaryCheckResult,
): InstalledAgent | null {
  // NPX distribution — preferred for registry agents other than Pi ACP.
  const npx = agent.distribution.npx;
  if (npx) {
    // Pi ACP is intentionally user-managed. Register the PATH command instead
    // of retaining an npx package reference that could download at launch.
    if (agent.id === "pi-acp") {
      return {
        id: agent.id,
        name: agent.name,
        engine: "acp",
        binary: "pi-acp",
        args: npx.args,
        env: npx.env,
        icon: agent.icon,
        registryId: agent.id,
        registryVersion: agent.version,
        description: agent.description,
      };
    }
    return {
      id: agent.id,
      name: agent.name,
      engine: "acp",
      binary: "npx",
      args: [npx.package, ...(npx.args ?? [])],
      env: npx.env,
      icon: agent.icon,
      registryId: agent.id,
      registryVersion: agent.version,
      description: agent.description,
    };
  }

  // Binary distribution — uses system-installed binary detected via `which`
  if (binaryInfo) {
    return {
      id: agent.id,
      name: agent.name,
      engine: "acp",
      binary: binaryInfo.path,
      args: binaryInfo.args,
      icon: agent.icon,
      registryId: agent.id,
      registryVersion: agent.version,
      description: agent.description,
    };
  }

  return null;
}

/**
 * Check if a registry agent has a newer version than the installed agent.
 * Only meaningful for agents installed from the registry (have registryVersion).
 */
export function hasUpdate(
  installed: InstalledAgent,
  registry: RegistryAgent,
): boolean {
  if (!installed.registryVersion) return false;
  return installed.registryVersion !== registry.version;
}

/**
 * Check whether a registry agent can be registered from the store — either via npx
 * or because the binary was detected on the system PATH.
 */
export function isInstallable(
  agent: RegistryAgent,
  binaryPaths?: Record<string, BinaryCheckResult>,
): boolean {
  if (agent.distribution.npx != null) return true;
  if (binaryPaths && binaryPaths[agent.id]) return true;
  return false;
}

export function getPreferredRegistryBinaryTarget(
  agent: RegistryAgent,
  platformKeys: string[],
): RegistryBinaryTarget | null {
  const binary = agent.distribution.binary;
  if (!binary) return null;

  for (const key of platformKeys) {
    const target = binary[key];
    if (target) return target;
  }

  return null;
}

export function getRegistryAgentSetupUrl(
  agent: RegistryAgent,
  platformKeys: string[],
): string | null {
  const target = getPreferredRegistryBinaryTarget(agent, platformKeys);
  if (target?.archive) return target.archive;
  return agent.repository ?? null;
}
