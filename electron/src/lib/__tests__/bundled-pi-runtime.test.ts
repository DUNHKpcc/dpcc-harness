import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledPiEnvironment,
  inspectBundledPiRuntime,
  resolveHeadlessRuntimeHostPath,
  resolveBundledPiRuntime,
  type BundledPiRuntimeContext,
} from "../bundled-pi-runtime";

const temporaryDirectories: string[] = [];
const nodeRequire = createRequire(__filename);

function createContext(options: {
  packaged?: boolean;
  piVersion?: string;
  piAcpVersion?: string;
  piMcpAdapterVersion?: string;
  includePi?: boolean;
  includePiAcp?: boolean;
  includePiMcpAdapter?: boolean;
  includeMcpBridge?: boolean;
  includeContextBridge?: boolean;
  includeWrapper?: boolean;
} = {}): BundledPiRuntimeContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-agent-bundled-pi-"));
  temporaryDirectories.push(root);
  const appPath = path.join(root, "app");
  const resourcesPath = path.join(root, "resources");
  const modulesRoot = path.join(appPath, "node_modules");
  const hostPath = path.join(root, process.platform === "win32" ? "PccAgent.exe" : "PccAgent");
  fs.mkdirSync(modulesRoot, { recursive: true });
  fs.writeFileSync(hostPath, "runtime-host", { mode: 0o755 });

  const writePackage = (packageName: string, version: string, entry: string) => {
    const packageRoot = path.join(modulesRoot, ...packageName.split("/"));
    fs.mkdirSync(path.join(packageRoot, path.dirname(entry)), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: packageName,
      version,
    }));
    fs.writeFileSync(path.join(packageRoot, entry), "// fixture\n");
  };

  if (options.includePi !== false) {
    writePackage(
      "@earendil-works/pi-coding-agent",
      options.piVersion ?? "0.84.1",
      "dist/cli.js",
    );
  }
  if (options.includePiAcp !== false) {
    writePackage("pi-acp", options.piAcpVersion ?? "0.0.33", "dist/index.js");
  }
  if (options.includePiMcpAdapter !== false) {
    writePackage("pi-mcp-adapter", options.piMcpAdapterVersion ?? "2.31.0", "index.ts");
  }

  const isPackaged = options.packaged === true;
  const runtimeRoot = path.join(
    isPackaged ? resourcesPath : path.join(appPath, "build"),
    "pi-runtime",
  );
  const wrapperPath = path.join(
    runtimeRoot,
    "bin",
    process.platform === "win32" ? "pi.cmd" : "pi",
  );
  if (options.includeWrapper !== false) {
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, "launcher", { mode: 0o755 });
  }
  if (options.includeMcpBridge !== false) {
    const bridgePath = path.join(runtimeRoot, "extensions", "pcc-mcp.ts");
    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.writeFileSync(bridgePath, "// fixture\n");
  }
  if (options.includeContextBridge !== false) {
    const bridgePath = path.join(runtimeRoot, "extensions", "pcc-context-usage.ts");
    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.writeFileSync(bridgePath, "// fixture\n");
  }

  return {
    appPath,
    resourcesPath,
    hostPath,
    isPackaged,
    platform: process.platform,
    modulePaths: [modulesRoot],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundled Pi runtime", () => {
  it("uses the headless Electron Helper for macOS Node child processes", () => {
    const mainExecutable = path.join(
      path.sep,
      "Applications",
      "PccAgent.app",
      "Contents",
      "MacOS",
      "PccAgent",
    );

    expect(resolveHeadlessRuntimeHostPath(mainExecutable, "darwin")).toBe(path.join(
      path.sep,
      "Applications",
      "PccAgent.app",
      "Contents",
      "Frameworks",
      "PccAgent Helper.app",
      "Contents",
      "MacOS",
      "PccAgent Helper",
    ));
    expect(resolveHeadlessRuntimeHostPath(mainExecutable, "linux")).toBe(mainExecutable);
    expect(resolveHeadlessRuntimeHostPath("/usr/local/bin/node", "darwin")).toBe("/usr/local/bin/node");
  });

  it("uses a macOS Helper bundle that is hidden from the Dock", () => {
    if (process.platform !== "darwin") return;

    const helperPath = resolveHeadlessRuntimeHostPath(String(nodeRequire("electron")), "darwin");
    const infoPlistPath = path.join(
      path.dirname(path.dirname(helperPath)),
      "Info.plist",
    );
    const infoPlist = fs.readFileSync(infoPlistPath, "utf8");

    expect(infoPlist).toMatch(/<key>LSUIElement<\/key>\s*<true\s*\/>/);
  });

  it("resolves the pinned offline runtime without consulting PATH", () => {
    const context = createContext();
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(path.dirname(context.hostPath), "system-pi-bin");
    try {
      const runtime = resolveBundledPiRuntime(context);

      expect(runtime).toMatchObject({
        source: "bundled",
        offlineReady: true,
        hostPath: context.hostPath,
        pi: { actualVersion: "0.84.1", available: true },
        piAcp: { actualVersion: "0.0.33", available: true },
        piMcpAdapter: { actualVersion: "2.31.0", available: true },
      });
      expect(runtime.piCommandPath).toContain(path.join("build", "pi-runtime", "bin"));
      expect(runtime.piContextExtensionPath).toContain(path.join("build", "pi-runtime", "extensions"));
      expect(bundledPiEnvironment(runtime)).toMatchObject({
        ELECTRON_RUN_AS_NODE: "1",
        PCC_AGENT_PI_RUNTIME_HOST: context.hostPath,
        PCC_AGENT_PI_ENTRY: runtime.pi.entryPath,
        PI_ACP_PI_COMMAND: runtime.piCommandPath,
        PCC_AGENT_PI_CONTEXT_EXTENSION: runtime.piContextExtensionPath,
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("uses the packaged extraResources launcher path", () => {
    const context = createContext({ packaged: true });

    expect(resolveBundledPiRuntime(context).piCommandPath).toBe(path.join(
      context.resourcesPath,
      "pi-runtime",
      "bin",
      process.platform === "win32" ? "pi.cmd" : "pi",
    ));
  });

  it("reports a missing launcher and version mismatch with stable codes", () => {
    const missingWrapper = createContext({ includeWrapper: false });
    expect(inspectBundledPiRuntime(missingWrapper).offlineReady).toBe(false);
    expect(() => resolveBundledPiRuntime(missingWrapper)).toThrow(expect.objectContaining({
      code: "pi_bundled_wrapper_missing",
    }));

    const mismatchedPi = createContext({ piVersion: "0.84.2" });
    expect(() => resolveBundledPiRuntime(mismatchedPi)).toThrow(expect.objectContaining({
      code: "pi_bundled_version_mismatch",
    }));
  });

  it("fails closed when the bundled context bridge is unavailable", () => {
    const context = createContext({ includeContextBridge: false });

    expect(inspectBundledPiRuntime(context)).toMatchObject({
      offlineReady: false,
      piContextExtensionAvailable: false,
    });
    expect(() => resolveBundledPiRuntime(context)).toThrow(expect.objectContaining({
      code: "pi_context_bridge_missing",
    }));
  });

  it("does not accept a system installation when bundled packages are absent", () => {
    const context = createContext({
      includePi: false,
      includePiAcp: false,
      includePiMcpAdapter: false,
    });

    expect(inspectBundledPiRuntime(context)).toMatchObject({
      offlineReady: false,
      pi: { code: "pi_bundled_package_missing" },
      piAcp: { code: "pi_acp_bundled_package_missing" },
      piMcpAdapter: { code: "pi_mcp_bundled_package_missing" },
    });
    expect(() => resolveBundledPiRuntime(context)).toThrow(expect.objectContaining({
      code: "pi_bundled_package_missing",
    }));
  });
});
