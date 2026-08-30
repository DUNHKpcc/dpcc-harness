import {
  inspectBundledPiRuntime,
  type BundledPiRuntimeComponent,
  type BundledPiRuntimeInspection,
} from "./bundled-pi-runtime";
import type {
  PiRuntimeBinaryName,
  PiRuntimeBinaryStatus,
  PiRuntimeStatus,
} from "@shared/types/registry";

interface PiRuntimeStatusDependencies {
  inspectRuntime?: () => BundledPiRuntimeInspection;
  now?: () => Date;
}

function packageFailureCode(
  binary: PiRuntimeBinaryName,
  kind: "missing" | "version-mismatch",
): PiRuntimeBinaryStatus["code"] {
  if (binary === "pi") {
    return kind === "missing" ? "pi_bundled_package_missing" : "pi_bundled_version_mismatch";
  }
  if (binary === "pi-acp") {
    return kind === "missing" ? "pi_acp_bundled_package_missing" : "pi_acp_bundled_version_mismatch";
  }
  return kind === "missing" ? "pi_mcp_bundled_package_missing" : "pi_mcp_bundled_version_mismatch";
}

function componentStatus(
  binary: PiRuntimeBinaryName,
  component: BundledPiRuntimeComponent,
  inspection: BundledPiRuntimeInspection,
): PiRuntimeBinaryStatus {
  let status: PiRuntimeBinaryStatus["status"] = "ok";
  let code: PiRuntimeBinaryStatus["code"] = null;
  let available = component.available;

  if (!inspection.hostAvailable) {
    status = "missing";
    code = "pi_runtime_host_missing";
    available = false;
  } else if (binary === "pi" && !inspection.piCommandAvailable) {
    status = "missing";
    code = "pi_bundled_wrapper_missing";
    available = false;
  } else if (binary === "pi-mcp-adapter" && !inspection.piMcpBridgeAvailable) {
    status = "missing";
    code = "pi_mcp_bridge_missing";
    available = false;
  } else if (!component.entryPath || component.actualVersion === null) {
    status = "missing";
    code = packageFailureCode(binary, "missing");
    available = false;
  } else if (component.actualVersion !== component.expectedVersion) {
    status = "version-mismatch";
    code = packageFailureCode(binary, "version-mismatch");
    available = false;
  }

  return {
    binary,
    packageName: component.packageName,
    source: "bundled",
    available,
    resolvedPath: component.entryPath,
    expectedVersion: component.expectedVersion,
    actualVersion: component.actualVersion,
    status,
    code,
  };
}

export async function getPiRuntimeStatus(
  dependencies: PiRuntimeStatusDependencies = {},
): Promise<PiRuntimeStatus> {
  const inspection = (dependencies.inspectRuntime ?? inspectBundledPiRuntime)();
  return {
    source: "bundled",
    offlineReady: inspection.offlineReady,
    runtimeHostPath: inspection.hostPath,
    runtimeHostAvailable: inspection.hostAvailable,
    pi: componentStatus("pi", inspection.pi, inspection),
    piAcp: componentStatus("pi-acp", inspection.piAcp, inspection),
    piMcpAdapter: componentStatus("pi-mcp-adapter", inspection.piMcpAdapter, inspection),
    checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };
}
