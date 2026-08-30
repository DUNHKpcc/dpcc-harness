import { describe, expect, it } from "vitest";
import type { BundledPiRuntimeInspection } from "../bundled-pi-runtime";
import { getPiRuntimeStatus } from "../pi-runtime-status";

function inspection(
  patch: Partial<BundledPiRuntimeInspection> = {},
): BundledPiRuntimeInspection {
  const value: BundledPiRuntimeInspection = {
    source: "bundled",
    isPackaged: true,
    hostPath: "/Applications/PccAgent/PccAgent",
    hostAvailable: true,
    piCommandPath: "/Applications/PccAgent/Resources/pi-runtime/bin/pi",
    piCommandAvailable: true,
    piMcpBridgePath: "/Applications/PccAgent/Resources/pi-runtime/extensions/pcc-mcp.ts",
    piMcpBridgeAvailable: true,
    pi: {
      packageName: "@earendil-works/pi-coding-agent",
      expectedVersion: "0.84.1",
      actualVersion: "0.84.1",
      packageRoot: "/Applications/PccAgent/Resources/app.asar/node_modules/pi",
      entryPath: "/Applications/PccAgent/Resources/app.asar/node_modules/pi/dist/cli.js",
      available: true,
      code: null,
    },
    piAcp: {
      packageName: "pi-acp",
      expectedVersion: "0.0.33",
      actualVersion: "0.0.33",
      packageRoot: "/Applications/PccAgent/Resources/app.asar/node_modules/pi-acp",
      entryPath: "/Applications/PccAgent/Resources/app.asar/node_modules/pi-acp/dist/index.js",
      available: true,
      code: null,
    },
    piMcpAdapter: {
      packageName: "pi-mcp-adapter",
      expectedVersion: "2.31.0",
      actualVersion: "2.31.0",
      packageRoot: "/Applications/PccAgent/Resources/app.asar/node_modules/pi-mcp-adapter",
      entryPath: "/Applications/PccAgent/Resources/app.asar/node_modules/pi-mcp-adapter/index.ts",
      available: true,
      code: null,
    },
    offlineReady: true,
  };
  return { ...value, ...patch };
}

describe("Pi runtime status", () => {
  it("reports the bundled runtime as offline ready", async () => {
    const result = await getPiRuntimeStatus({
      inspectRuntime: () => inspection(),
      now: () => new Date("2026-08-29T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      source: "bundled",
      offlineReady: true,
      runtimeHostAvailable: true,
      pi: {
        source: "bundled",
        available: true,
        status: "ok",
        code: null,
        actualVersion: "0.84.1",
      },
      piAcp: {
        source: "bundled",
        available: true,
        status: "ok",
        code: null,
        actualVersion: "0.0.33",
      },
      piMcpAdapter: {
        source: "bundled",
        available: true,
        status: "ok",
        code: null,
        actualVersion: "2.31.0",
      },
      checkedAt: "2026-08-29T00:00:00.000Z",
    });
  });

  it("keeps runtime host and launcher failures distinct", async () => {
    const missingHost = await getPiRuntimeStatus({
      inspectRuntime: () => inspection({ hostAvailable: false, offlineReady: false }),
    });
    expect(missingHost.pi.code).toBe("pi_runtime_host_missing");
    expect(missingHost.piAcp.code).toBe("pi_runtime_host_missing");
    expect(missingHost.piMcpAdapter.code).toBe("pi_runtime_host_missing");

    const missingLauncher = await getPiRuntimeStatus({
      inspectRuntime: () => inspection({ piCommandAvailable: false, offlineReady: false }),
    });
    expect(missingLauncher.pi).toMatchObject({
      available: false,
      status: "missing",
      code: "pi_bundled_wrapper_missing",
    });
    expect(missingLauncher.piAcp.status).toBe("ok");
    expect(missingLauncher.piMcpAdapter.status).toBe("ok");
  });

  it("reports exact bundled package and version failures", async () => {
    const missingPiAcp = inspection({ offlineReady: false });
    missingPiAcp.piAcp = {
      ...missingPiAcp.piAcp,
      actualVersion: null,
      entryPath: null,
      available: false,
      code: "pi_acp_bundled_package_missing",
    };
    const missingResult = await getPiRuntimeStatus({ inspectRuntime: () => missingPiAcp });
    expect(missingResult.piAcp).toMatchObject({
      status: "missing",
      code: "pi_acp_bundled_package_missing",
    });

    const mismatchedPi = inspection({ offlineReady: false });
    mismatchedPi.pi = {
      ...mismatchedPi.pi,
      actualVersion: "0.84.2",
      available: false,
      code: "pi_bundled_version_mismatch",
    };
    const mismatchResult = await getPiRuntimeStatus({ inspectRuntime: () => mismatchedPi });
    expect(mismatchResult.pi).toMatchObject({
      status: "version-mismatch",
      code: "pi_bundled_version_mismatch",
    });

    const missingBridge = await getPiRuntimeStatus({
      inspectRuntime: () => inspection({ piMcpBridgeAvailable: false, offlineReady: false }),
    });
    expect(missingBridge.piMcpAdapter).toMatchObject({
      available: false,
      status: "missing",
      code: "pi_mcp_bridge_missing",
    });
  });
});
