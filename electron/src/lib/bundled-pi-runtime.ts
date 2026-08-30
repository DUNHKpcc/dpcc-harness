import fs from "fs";
import path from "path";
import runtimeManifest from "../../../scripts/pi-runtime-versions.json";

export type BundledPiRuntimeErrorCode =
  | "pi_runtime_host_missing"
  | "pi_bundled_wrapper_missing"
  | "pi_bundled_package_missing"
  | "pi_acp_bundled_package_missing"
  | "pi_mcp_bundled_package_missing"
  | "pi_mcp_bridge_missing"
  | "pi_bundled_version_mismatch"
  | "pi_acp_bundled_version_mismatch"
  | "pi_mcp_bundled_version_mismatch";

export interface BundledPiRuntimeComponent {
  packageName: string;
  expectedVersion: string;
  actualVersion: string | null;
  packageRoot: string | null;
  entryPath: string | null;
  available: boolean;
  code: BundledPiRuntimeErrorCode | null;
}

export interface BundledPiRuntimeInspection {
  source: "bundled";
  isPackaged: boolean;
  hostPath: string;
  hostAvailable: boolean;
  piCommandPath: string;
  piCommandAvailable: boolean;
  piMcpBridgePath: string;
  piMcpBridgeAvailable: boolean;
  pi: BundledPiRuntimeComponent;
  piAcp: BundledPiRuntimeComponent;
  piMcpAdapter: BundledPiRuntimeComponent;
  offlineReady: boolean;
}

export interface BundledPiRuntime extends BundledPiRuntimeInspection {
  hostAvailable: true;
  piCommandAvailable: true;
  pi: BundledPiRuntimeComponent & { entryPath: string; available: true; code: null };
  piAcp: BundledPiRuntimeComponent & { entryPath: string; available: true; code: null };
  piMcpAdapter: BundledPiRuntimeComponent & { entryPath: string; available: true; code: null };
  piMcpBridgeAvailable: true;
  offlineReady: true;
}

export interface BundledPiRuntimeContext {
  appPath: string;
  resourcesPath: string;
  hostPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  modulePaths?: string[];
}

function codedError(code: BundledPiRuntimeErrorCode, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * Electron's main app executable registers as a GUI application on macOS even
 * with ELECTRON_RUN_AS_NODE. Use the app's headless Helper executable for
 * bundled Node workloads so Pi remains a child of PccAgent without a Dock app.
 */
export function resolveHeadlessRuntimeHostPath(
  executablePath: string,
  platform: NodeJS.Platform,
): string {
  if (platform !== "darwin") return executablePath;

  const macOsDirectory = path.dirname(executablePath);
  const contentsDirectory = path.dirname(macOsDirectory);
  const appDirectory = path.dirname(contentsDirectory);
  if (
    path.basename(macOsDirectory) !== "MacOS"
    || path.basename(contentsDirectory) !== "Contents"
    || path.extname(appDirectory) !== ".app"
  ) {
    return executablePath;
  }

  const executableName = path.basename(executablePath);
  const helperName = `${executableName} Helper`;
  return path.join(
    contentsDirectory,
    "Frameworks",
    `${helperName}.app`,
    "Contents",
    "MacOS",
    helperName,
  );
}

function defaultContext(): BundledPiRuntimeContext {
  let appPath = process.cwd();
  let isPackaged = false;
  try {
    const electron = require("electron") as { app?: { getAppPath?: () => string; isPackaged?: boolean } };
    if (electron.app?.getAppPath) appPath = electron.app.getAppPath();
    isPackaged = electron.app?.isPackaged === true;
  } catch {
    // Plain Node tests and runtime doctor use the repository as the app root.
  }
  return {
    appPath,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      ?? path.dirname(appPath),
    hostPath: resolveHeadlessRuntimeHostPath(process.execPath, process.platform),
    isPackaged,
    platform: process.platform,
  };
}

function packagePathSegments(packageName: string): string[] {
  return packageName.split("/").filter(Boolean);
}

function packageSearchRoots(
  packageName: string,
  context: BundledPiRuntimeContext,
): string[] {
  const roots = new Set<string>();
  for (const candidate of context.modulePaths ?? require.resolve.paths(packageName) ?? []) {
    roots.add(candidate);
  }
  roots.add(path.join(context.appPath, "node_modules"));
  roots.add(path.join(context.resourcesPath, "app.asar", "node_modules"));
  roots.add(path.join(context.resourcesPath, "app.asar.unpacked", "node_modules"));
  return [...roots];
}

function inspectComponent(
  packageName: string,
  expectedVersion: string,
  entryRelativePath: string,
  missingCode: BundledPiRuntimeErrorCode,
  mismatchCode: BundledPiRuntimeErrorCode,
  context: BundledPiRuntimeContext,
): BundledPiRuntimeComponent {
  const segments = packagePathSegments(packageName);
  for (const modulesRoot of packageSearchRoots(packageName, context)) {
    const packageRoot = path.join(modulesRoot, ...segments);
    const packageJsonPath = path.join(packageRoot, "package.json");
    const entryPath = path.join(packageRoot, entryRelativePath);
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (packageJson.name !== packageName || typeof packageJson.version !== "string") continue;
      if (!fs.statSync(entryPath).isFile()) continue;
      const actualVersion = packageJson.version;
      const matches = actualVersion === expectedVersion;
      return {
        packageName,
        expectedVersion,
        actualVersion,
        packageRoot,
        entryPath,
        available: matches,
        code: matches ? null : mismatchCode,
      };
    } catch {
      // Continue through Node's package search roots before declaring it absent.
    }
  }
  return {
    packageName,
    expectedVersion,
    actualVersion: null,
    packageRoot: null,
    entryPath: null,
    available: false,
    code: missingCode,
  };
}

function canAccess(filePath: string, executable: boolean, platform: NodeJS.Platform): boolean {
  try {
    const mode = executable && platform !== "win32" ? fs.constants.X_OK : fs.constants.F_OK;
    fs.accessSync(filePath, mode);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function piRuntimeResourceRoot(context: BundledPiRuntimeContext): string {
  return context.isPackaged
    ? context.resourcesPath
    : path.join(context.appPath, "build");
}

function piCommandPath(context: BundledPiRuntimeContext): string {
  const root = piRuntimeResourceRoot(context);
  return path.join(
    root,
    "pi-runtime",
    "bin",
    context.platform === "win32" ? "pi.cmd" : "pi",
  );
}

function piMcpBridgePath(context: BundledPiRuntimeContext): string {
  return path.join(piRuntimeResourceRoot(context), "pi-runtime", "extensions", "pcc-mcp.ts");
}

export function inspectBundledPiRuntime(
  overrides: Partial<BundledPiRuntimeContext> = {},
): BundledPiRuntimeInspection {
  const context = { ...defaultContext(), ...overrides };
  const commandPath = piCommandPath(context);
  const mcpBridgePath = piMcpBridgePath(context);
  const hostAvailable = canAccess(context.hostPath, true, context.platform);
  const piCommandAvailable = canAccess(commandPath, true, context.platform);
  const piMcpBridgeAvailable = canAccess(mcpBridgePath, false, context.platform);
  const pi = inspectComponent(
    runtimeManifest.binaries.pi.package,
    runtimeManifest.binaries.pi.version,
    "dist/cli.js",
    "pi_bundled_package_missing",
    "pi_bundled_version_mismatch",
    context,
  );
  const piAcp = inspectComponent(
    runtimeManifest.binaries["pi-acp"].package,
    runtimeManifest.binaries["pi-acp"].version,
    "dist/index.js",
    "pi_acp_bundled_package_missing",
    "pi_acp_bundled_version_mismatch",
    context,
  );
  const piMcpAdapter = inspectComponent(
    runtimeManifest.extensions["pi-mcp-adapter"].package,
    runtimeManifest.extensions["pi-mcp-adapter"].version,
    runtimeManifest.extensions["pi-mcp-adapter"].entry,
    "pi_mcp_bundled_package_missing",
    "pi_mcp_bundled_version_mismatch",
    context,
  );
  return {
    source: "bundled",
    isPackaged: context.isPackaged,
    hostPath: context.hostPath,
    hostAvailable,
    piCommandPath: commandPath,
    piCommandAvailable,
    piMcpBridgePath: mcpBridgePath,
    piMcpBridgeAvailable,
    pi,
    piAcp,
    piMcpAdapter,
    offlineReady: hostAvailable
      && piCommandAvailable
      && piMcpBridgeAvailable
      && pi.available
      && piAcp.available
      && piMcpAdapter.available,
  };
}

export function resolveBundledPiRuntime(
  overrides: Partial<BundledPiRuntimeContext> = {},
): BundledPiRuntime {
  const inspected = inspectBundledPiRuntime(overrides);
  if (!inspected.hostAvailable) {
    throw codedError("pi_runtime_host_missing", "The embedded Electron runtime host is unavailable.");
  }
  if (!inspected.piCommandAvailable) {
    throw codedError("pi_bundled_wrapper_missing", "The bundled Pi launcher is missing from the application resources.");
  }
  if (!inspected.pi.available) {
    throw codedError(
      inspected.pi.code ?? "pi_bundled_package_missing",
      inspected.pi.actualVersion
        ? `Bundled Pi version ${inspected.pi.actualVersion} does not match ${inspected.pi.expectedVersion}.`
        : "The bundled Pi package is missing from the application.",
    );
  }
  if (!inspected.piAcp.available) {
    throw codedError(
      inspected.piAcp.code ?? "pi_acp_bundled_package_missing",
      inspected.piAcp.actualVersion
        ? `Bundled pi-acp version ${inspected.piAcp.actualVersion} does not match ${inspected.piAcp.expectedVersion}.`
        : "The bundled pi-acp package is missing from the application.",
    );
  }
  if (!inspected.piMcpBridgeAvailable) {
    throw codedError(
      "pi_mcp_bridge_missing",
      "The bundled Pi MCP bridge is missing from the application resources.",
    );
  }
  if (!inspected.piMcpAdapter.available) {
    throw codedError(
      inspected.piMcpAdapter.code ?? "pi_mcp_bundled_package_missing",
      inspected.piMcpAdapter.actualVersion
        ? `Bundled Pi MCP adapter version ${inspected.piMcpAdapter.actualVersion} does not match ${inspected.piMcpAdapter.expectedVersion}.`
        : "The bundled Pi MCP adapter package is missing from the application.",
    );
  }
  return inspected as BundledPiRuntime;
}

export function bundledPiEnvironment(
  runtime: BundledPiRuntime,
  piCommand = runtime.piCommandPath,
): NodeJS.ProcessEnv {
  return {
    ELECTRON_RUN_AS_NODE: "1",
    PCC_AGENT_PI_RUNTIME_HOST: runtime.hostPath,
    PCC_AGENT_PI_ENTRY: runtime.pi.entryPath,
    PI_ACP_PI_COMMAND: piCommand,
  };
}
