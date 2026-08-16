import { describe, expect, it } from "vitest";
import type { ACPConfigOption, InstalledAgent, RegistryAgent } from "@/types";
import type { BinaryCheckResult } from "@/lib/engine/acp-agent-registry";
import {
  mergeRegistryAgentUpdate,
  planAcpAgentUpdates,
} from "@/lib/engine/acp-agent-updates";
import { registryAgentToDefinition } from "@/lib/background/agent-store-utils";

function makeRegistryAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: "agent-1",
    name: "Agent One",
    version: "1.1.0",
    description: "Test agent",
    authors: ["ACP"],
    license: "MIT",
    distribution: {
      npx: {
        package: "@acp/agent-one",
      },
    },
    ...overrides,
  };
}

function makeInstalledAgent(overrides: Partial<InstalledAgent> = {}): InstalledAgent {
  return {
    id: "agent-1",
    name: "Agent One",
    engine: "acp",
    binary: "npx",
    args: ["@acp/agent-one"],
    registryId: "agent-1",
    registryVersion: "1.0.0",
    description: "Old description",
    ...overrides,
  };
}

describe("mergeRegistryAgentUpdate", () => {
  it("preserves local agent id and cached config options", () => {
    const cachedConfigOptions: ACPConfigOption[] = [{
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "sonnet",
      options: [{ value: "sonnet", name: "Sonnet" }],
    }];
    const existing = makeInstalledAgent({
      id: "custom-local-id",
      cachedConfigOptions,
    });
    const next = makeInstalledAgent({
      id: "agent-1",
      registryVersion: "1.1.0",
      description: "New description",
    });

    expect(mergeRegistryAgentUpdate(existing, next)).toEqual({
      ...next,
      id: "custom-local-id",
      cachedConfigOptions,
    });
  });
});

describe("planAcpAgentUpdates", () => {
  it("plans updates for newer registry-backed ACP agents", () => {
    const installed = [makeInstalledAgent()];
    const registry = [makeRegistryAgent()];

    const updates = planAcpAgentUpdates(installed, registry, {});

    expect(updates).toHaveLength(1);
    expect(updates[0]?.current.id).toBe("agent-1");
    expect(updates[0]?.next.registryVersion).toBe("1.1.0");
    expect(updates[0]?.next.args).toEqual(["@acp/agent-one"]);
  });

  it("skips agents that do not have a registry update", () => {
    const installed = [makeInstalledAgent({ registryVersion: "1.1.0" })];
    const registry = [makeRegistryAgent()];

    expect(planAcpAgentUpdates(installed, registry, {})).toEqual([]);
  });

  it("skips registry agents that are not one-click installable", () => {
    const installed = [makeInstalledAgent({ registryId: "binary-agent" })];
    const registry = [makeRegistryAgent({
      id: "binary-agent",
      distribution: {
        binary: {
          "darwin-aarch64": {
            archive: "https://example.com/binary-agent.tar.gz",
            cmd: "binary-agent",
          },
        },
      },
    })];

    expect(planAcpAgentUpdates(installed, registry, {})).toEqual([]);
  });

  it("uses detected binary paths for binary-backed registry agents", () => {
    const installed = [makeInstalledAgent({
      id: "binary-agent",
      registryId: "binary-agent",
      binary: "/usr/local/bin/binary-agent",
      args: undefined,
    })];
    const registry = [makeRegistryAgent({
      id: "binary-agent",
      distribution: {
        binary: {
          "darwin-aarch64": {
            archive: "https://example.com/binary-agent.tar.gz",
            cmd: "binary-agent",
            args: ["serve"],
          },
        },
      },
    })];
    const binaryPaths: Record<string, BinaryCheckResult> = {
      "binary-agent": {
        path: "/opt/homebrew/bin/binary-agent",
        args: ["serve"],
      },
    };

    const updates = planAcpAgentUpdates(installed, registry, binaryPaths);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.next.binary).toBe("/opt/homebrew/bin/binary-agent");
    expect(updates[0]?.next.args).toEqual(["serve"]);
  });
});

describe("registryAgentToDefinition", () => {
  it("registers Pi ACP as a user-installed PATH command instead of npx", () => {
    const definition = registryAgentToDefinition(makeRegistryAgent({
      id: "pi-acp",
      distribution: {
        npx: {
          package: "pi-acp@0.0.33",
          args: ["--adapter-flag"],
        },
      },
    }));

    expect(definition).toMatchObject({
      id: "pi-acp",
      binary: "pi-acp",
      args: ["--adapter-flag"],
      registryId: "pi-acp",
    });
  });
});
