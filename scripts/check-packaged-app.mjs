import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const {
  normalizeAsarEntry,
  toAsarLookupEntry,
} = require("./lib/asar-entry-path.js");
const packageJson = require("../package.json");
const [targetArgument] = process.argv.slice(2).filter((argument) => argument !== "--");
const targetPath = path.resolve(targetArgument ?? "");

if (!targetArgument || !fs.existsSync(targetPath)) {
  console.error("Usage: pnpm package:smoke -- <unpacked app or release directory>");
  process.exit(1);
}

function collectAsarPaths(startPath) {
  if (path.basename(startPath) === "app.asar" && fs.statSync(startPath).isFile()) {
    return [startPath];
  }

  const found = [];
  const pending = [startPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === "app.asar") {
        found.push(entryPath);
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return found.sort();
}

function assertPackagedRenderer(asarPath) {
  const entries = asar.listPackage(asarPath).map(normalizeAsarEntry);
  const entrySet = new Set(entries);
  for (const requiredEntry of ["dist/index.html", "dist/icon.png"]) {
    if (!entrySet.has(requiredEntry)) {
      throw new Error(`${asarPath} is missing ${requiredEntry}`);
    }
  }

  const bundledRuntimeEntries = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    "node_modules/pi-acp/package.json",
    "node_modules/pi-acp/dist/index.js",
    "node_modules/pi-mcp-adapter/package.json",
    "node_modules/pi-mcp-adapter/index.ts",
  ];
  for (const requiredEntry of bundledRuntimeEntries) {
    if (!entrySet.has(requiredEntry)) {
      throw new Error(`${asarPath} is missing bundled runtime entry ${requiredEntry}`);
    }
  }
  const piPackage = JSON.parse(asar
    .extractFile(asarPath, toAsarLookupEntry(bundledRuntimeEntries[0]))
    .toString("utf8"));
  const piAcpPackage = JSON.parse(asar
    .extractFile(asarPath, toAsarLookupEntry(bundledRuntimeEntries[2]))
    .toString("utf8"));
  const piMcpAdapterPackage = JSON.parse(asar
    .extractFile(asarPath, toAsarLookupEntry(bundledRuntimeEntries[4]))
    .toString("utf8"));
  if (
    piPackage.version !== "0.84.1"
    || piAcpPackage.version !== "0.0.33"
    || piMcpAdapterPackage.version !== "2.31.0"
  ) {
    throw new Error(`${asarPath} contains unsupported bundled Pi runtime versions`);
  }

  const icon = asar.extractFile(asarPath, toAsarLookupEntry("dist/icon.png"));
  if (icon.length < 24 || icon.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error(`${asarPath} contains an invalid dist/icon.png`);
  }

  const indexHtml = asar
    .extractFile(asarPath, toAsarLookupEntry("dist/index.html"))
    .toString("utf8");
  for (const match of indexHtml.matchAll(/\b(?:href|src)="\.\/([^"]+)"/g)) {
    const referencedEntry = `dist/${match[1].split(/[?#]/, 1)[0]}`;
    if (!entrySet.has(referencedEntry)) {
      throw new Error(`${asarPath} index.html references missing ${referencedEntry}`);
    }
  }

  const productionMarkers = new Set([
    "data-pcc-agent-logo",
    "../../pcc-agent-logo.png",
    "account-menu",
    "open-settings",
    "data-settings-section",
    "terminal-shell-setting",
    "replay-welcome",
    "welcome-wizard",
    "pcc-agent-welcome-completed",
  ]);
  for (const entry of entries) {
    if (!entry.startsWith("dist/assets/") || !entry.endsWith(".js")) continue;
    const source = asar.extractFile(asarPath, toAsarLookupEntry(entry)).toString("utf8");
    for (const marker of productionMarkers) {
      if (source.includes(marker)) productionMarkers.delete(marker);
    }
  }
  if (productionMarkers.size > 0) {
    throw new Error(
      `${asarPath} production renderer is missing smoke markers: ${[...productionMarkers].join(", ")}`,
    );
  }

  const extraResourcesLogo = path.join(path.dirname(asarPath), "pcc-agent-logo.png");
  if (!fs.existsSync(extraResourcesLogo)) {
    throw new Error(`${asarPath} is missing extraResources/pcc-agent-logo.png`);
  }

  const piRuntimeLauncher = path.join(
    path.dirname(asarPath),
    "pi-runtime",
    "bin",
    platformForAppRoot(appRootForAsar(asarPath)) === "win32" ? "pi.cmd" : "pi",
  );
  const piRuntimeNotices = path.join(path.dirname(asarPath), "pi-runtime", "THIRD_PARTY_NOTICES.md");
  const piMcpBridge = path.join(path.dirname(asarPath), "pi-runtime", "extensions", "pcc-mcp.ts");
  const piContextBridge = path.join(path.dirname(asarPath), "pi-runtime", "extensions", "pcc-context-usage.ts");
  const piPackageBootstrap = path.join(path.dirname(asarPath), "pi-runtime", "bin", "pcc-pi-package-launch.cjs");
  if (
    !fs.existsSync(piRuntimeLauncher)
    || !fs.existsSync(piRuntimeNotices)
    || !fs.existsSync(piMcpBridge)
    || !fs.existsSync(piContextBridge)
    || !fs.existsSync(piPackageBootstrap)
  ) {
    throw new Error(`${asarPath} is missing bundled Pi extraResources`);
  }

  return { asarPath, extraResourcesLogo, piRuntimeLauncher, piContextBridge, piPackageBootstrap };
}

function appRootForAsar(asarPath) {
  const resourcesDir = path.dirname(asarPath);
  if (path.basename(path.dirname(resourcesDir)) === "Contents") {
    return path.dirname(path.dirname(resourcesDir));
  }
  return path.dirname(resourcesDir);
}

function platformForAppRoot(appRoot) {
  if (appRoot.endsWith(".app")) return "darwin";
  if (fs.existsSync(path.join(appRoot, `${packageJson.productName}.exe`))) return "win32";
  return "linux";
}

function runtimeCandidateScore({ appRoot }) {
  if (platformForAppRoot(appRoot) !== process.platform) return -1;
  const normalized = appRoot.replaceAll("\\", "/").toLowerCase();
  if (process.arch === "arm64") return normalized.includes("arm64") ? 2 : 1;
  return normalized.includes("arm64") ? 0 : 2;
}

function findExecutable(appRoot) {
  if (process.platform === "darwin") {
    return path.join(appRoot, "Contents", "MacOS", packageJson.productName);
  }

  const names = process.platform === "win32"
    ? [`${packageJson.productName}.exe`, `${packageJson.name}.exe`]
    : [packageJson.name, packageJson.productName, packageJson.productName.toLowerCase()];
  const executable = names
    .map((name) => path.join(appRoot, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(`Could not find the packaged executable in ${appRoot}`);
  }
  return executable;
}

function findHeadlessRuntimeHost(executable, appRoot) {
  if (platformForAppRoot(appRoot) !== "darwin") return executable;

  const helperName = `${path.basename(executable)} Helper`;
  const helperContents = path.join(
    appRoot,
    "Contents",
    "Frameworks",
    `${helperName}.app`,
    "Contents",
  );
  const helperExecutable = path.join(helperContents, "MacOS", helperName);
  const infoPlist = path.join(helperContents, "Info.plist");
  if (!fs.existsSync(helperExecutable) || !fs.existsSync(infoPlist)) {
    throw new Error(`${appRoot} is missing its headless Electron Helper runtime`);
  }

  const plistResult = spawnSync(
    "/usr/bin/plutil",
    ["-extract", "LSUIElement", "raw", "-o", "-", infoPlist],
    { encoding: "utf8" },
  );
  if (plistResult.status !== 0 || plistResult.stdout.trim() !== "true") {
    throw new Error(`${helperName} must set LSUIElement=true so Pi never creates a Dock app`);
  }
  return helperExecutable;
}

function runPackagedApp(executable, appRoot, extraResourcesLogo) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-package-smoke-"));
  const resultPath = path.join(tempDir, "result.json");
  const userDataPath = path.join(tempDir, "user-data");
  // Linux CI cannot provide the root-owned SUID sandbox expected by Chromium.
  // The smoke process is isolated and validates the packaged app, not sandbox setup.
  const sandboxArgs = platformForAppRoot(appRoot) === "linux" ? ["--no-sandbox"] : [];
  fs.mkdirSync(userDataPath);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...sandboxArgs, "--package-smoke-check"], {
      cwd: appRoot,
      env: {
        ...process.env,
        PCC_PACKAGE_SMOKE_RESULT: resultPath,
        PCC_PACKAGE_SMOKE_USER_DATA: userDataPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-100_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-100_000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(new Error(`Packaged app smoke check timed out\n${stdout}\n${stderr}`));
    }, 180_000);

    child.once("error", (error) => {
      clearTimeout(timer);
      fs.rmSync(tempDir, { recursive: true, force: true });
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      try {
        if (!fs.existsSync(resultPath)) {
          throw new Error(
            `Packaged app exited without a smoke result (code=${code}, signal=${signal})\n${stdout}\n${stderr}`,
          );
        }
        const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
        if (
          code !== 0
          || result.ok !== true
          || result.welcomeReplayTriggered !== true
          || result.terminalShellOptionsLoaded !== true
          || !Number.isInteger(result.terminalShellOptionCount)
          || result.terminalShellOptionCount < 2
          || typeof result.terminalAutoShellPath !== "string"
          || !path.isAbsolute(result.terminalAutoShellPath)
          || result.piRuntime?.source !== "bundled"
          || result.piRuntime?.offlineReady !== true
          || result.piRuntime?.pi?.actualVersion !== "0.84.1"
          || result.piRuntime?.piAcp?.actualVersion !== "0.0.33"
          || result.piRuntime?.piMcpAdapter?.actualVersion !== "2.31.0"
        ) {
          throw new Error(
            `Packaged app smoke check failed (code=${code}): ${result.error ?? "invalid result"}\n${stdout}\n${stderr}`,
          );
        }
        if (!result.asarLogoUrl.includes("app.asar") || !result.asarLogoUrl.endsWith("/dist/icon.png")) {
          throw new Error(`PccAgentLogo did not resolve from app.asar: ${result.asarLogoUrl}`);
        }
        const resolvedExtraResourcesLogo = fileURLToPath(result.extraResourcesLogoUrl);
        if (path.resolve(resolvedExtraResourcesLogo) !== path.resolve(extraResourcesLogo)) {
          throw new Error(
            `PccAgentLogo resolved the wrong extraResources path: ${result.extraResourcesLogoUrl}`,
          );
        }
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
}

function runPackagedPiVersion(runtimeHost, asarPath, launcherPath, contextBridgePath) {
  const piEntry = path.join(
    asarPath,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const child = spawn(launcherPath, ["--version"], {
    cwd: path.dirname(launcherPath),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PCC_AGENT_PI_RUNTIME_HOST: runtimeHost,
      PCC_AGENT_PI_ENTRY: piEntry,
      PCC_AGENT_PI_CONTEXT_EXTENSION: contextBridgePath,
      PATH: "",
    },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Packaged bundled Pi version check timed out"));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      const version = output.trim();
      if (code !== 0 || version !== "0.84.1") {
        reject(new Error(`Packaged bundled Pi failed offline launch (code=${code}, output=${version})`));
        return;
      }
      resolve(version);
    });
  });
}

const asarPaths = collectAsarPaths(targetPath);
if (asarPaths.length === 0) {
  throw new Error(`No app.asar found under ${targetPath}`);
}

const packagedApps = asarPaths.map((asarPath) => {
  const inspected = assertPackagedRenderer(asarPath);
  return {
    ...inspected,
    appRoot: appRootForAsar(asarPath),
  };
});

const runtimeCandidate = packagedApps
  .map((candidate) => ({ candidate, score: runtimeCandidateScore(candidate) }))
  .filter(({ score }) => score >= 0)
  .sort((a, b) => b.score - a.score)[0]?.candidate;
if (!runtimeCandidate) {
  throw new Error(`No ${process.platform}-${process.arch} packaged app found under ${targetPath}`);
}

const executable = findExecutable(runtimeCandidate.appRoot);
const runtimeHost = findHeadlessRuntimeHost(executable, runtimeCandidate.appRoot);
const result = await runPackagedApp(
  executable,
  runtimeCandidate.appRoot,
  runtimeCandidate.extraResourcesLogo,
);
const bundledPiVersion = await runPackagedPiVersion(
  runtimeHost,
  runtimeCandidate.asarPath,
  runtimeCandidate.piRuntimeLauncher,
  runtimeCandidate.piContextBridge,
);

console.log(
  `package smoke check passed (${packagedApps.length} app.asar, runtime ${path.basename(runtimeCandidate.appRoot)})`,
);
console.log(`  asar logo: ${result.asarLogoUrl}`);
console.log(`  extraResources logo: ${result.extraResourcesLogoUrl}`);
console.log(
  `  terminal shells: ${result.terminalShellOptionCount} option(s), auto=${result.terminalAutoShellPath}`,
);
console.log(`  bundled Pi: ${bundledPiVersion} (offline launcher via ${path.basename(runtimeHost)})`);
console.log("  production welcome replay: triggered");
