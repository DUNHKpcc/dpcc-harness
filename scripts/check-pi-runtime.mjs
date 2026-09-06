#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(process.env.PI_RUNTIME_DOCTOR_ROOT?.trim() || path.join(scriptDir, ".."));
const manifestPath = path.join(repoRoot, "scripts", "pi-runtime-versions.json");
const jsonOutput = process.argv.includes("--json");
const timeoutMs = Number(process.env.PI_RUNTIME_DOCTOR_TIMEOUT_MS ?? 10_000);
const { parse: parseYaml } = require("yaml");

const CREDENTIAL_KEYS = [
  "PCC_AGENT_PI_DPCC_CLAUDE_KEY",
  "PCC_AGENT_PI_DPCC_CODEX_KEY",
  "PCC_AGENT_PI_GATEWAY_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
];

function parseSemver(value) {
  const match = String(value ?? "").match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?(?:$|[^\d])/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
  };
}

function compareSemver(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function fileAvailable(filePath, executable = false) {
  try {
    fs.accessSync(filePath, executable && process.platform !== "win32" ? fs.constants.X_OK : fs.constants.F_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function packageRoot(packageName) {
  return path.join(repoRoot, "node_modules", ...packageName.split("/"));
}

function componentCode(key, kind) {
  if (key === "pi") {
    return kind === "missing" ? "pi_bundled_package_missing" : "pi_bundled_version_mismatch";
  }
  if (key === "pi-acp") {
    return kind === "missing" ? "pi_acp_bundled_package_missing" : "pi_acp_bundled_version_mismatch";
  }
  return kind === "missing" ? "pi_mcp_bundled_package_missing" : "pi_mcp_bundled_version_mismatch";
}

function resolveHeadlessElectronHost(executablePath) {
  if (process.platform !== "darwin") return executablePath;
  const macOsDirectory = path.dirname(executablePath);
  const contentsDirectory = path.dirname(macOsDirectory);
  const appDirectory = path.dirname(contentsDirectory);
  if (path.basename(macOsDirectory) !== "MacOS"
    || path.basename(contentsDirectory) !== "Contents"
    || path.extname(appDirectory) !== ".app") {
    return executablePath;
  }
  const executableName = path.basename(executablePath);
  const helperName = `${executableName} Helper`;
  return path.join(contentsDirectory, "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
}

function inspectBundledComponent(key, expected, packageJson, lockfile) {
  const root = packageRoot(expected.package);
  const entryPath = path.join(root, expected.entry);
  let actualVersion = null;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (value.name === expected.package && typeof value.version === "string") actualVersion = value.version;
  } catch {
    // Report a stable missing-package code below.
  }
  const dependencyPinned = packageJson.dependencies?.[expected.package] === expected.version;
  const lockEntry = lockfile.packages?.[`${expected.package}@${expected.version}`];
  const integrityPinned = typeof lockEntry?.resolution?.integrity === "string"
    && lockEntry.resolution.integrity.length > 0;
  const entryAvailable = fileAvailable(entryPath);
  const versionMatches = actualVersion === expected.version;
  const code = !actualVersion || !entryAvailable
    ? componentCode(key, "missing")
    : !versionMatches
      ? componentCode(key, "version-mismatch")
      : !dependencyPinned
        ? "runtime_dependency_not_pinned"
        : !integrityPinned
          ? "runtime_integrity_missing"
          : null;
  return {
    key,
    binary: expected.binary ?? key,
    package: expected.package,
    source: "bundled",
    expectedVersion: expected.version,
    actualVersion,
    packageRoot: root,
    entryPath,
    dependencyPinned,
    integrityPinned,
    ok: code === null,
    code,
  };
}

function runtimeEnvironment(hostPath, piEntryPath, piCommandPath, isolation) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PCC_AGENT_PI_RUNTIME_HOST: hostPath,
    PCC_AGENT_PI_ENTRY: piEntryPath,
    PI_ACP_PI_COMMAND: piCommandPath,
    PCC_AGENT_PI_MCP_EXTENSION: "",
    PCC_AGENT_PI_MCP_CONFIG: "",
    PCC_AGENT_PI_MCP_ADAPTER: "",
    PCC_AGENT_PI_CONTEXT_EXTENSION: "",
    PCC_AGENT_PI_PACKAGE_BOOTSTRAP: "",
    PCC_AGENT_PI_PACKAGE_CONFIG: "",
    HOME: isolation.home,
    USERPROFILE: isolation.home,
    XDG_CONFIG_HOME: isolation.config,
    XDG_DATA_HOME: isolation.data,
    XDG_CACHE_HOME: isolation.cache,
    PI_CODING_AGENT_DIR: isolation.pi,
  };
  for (const key of CREDENTIAL_KEYS) delete env[key];
  return env;
}

function runVersion(command, args, env, shell = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    shell,
    timeout: timeoutMs,
    windowsHide: true,
  });
  const version = parseSemver(`${result.stdout ?? ""}${result.stderr ?? ""}`)?.text ?? null;
  return {
    ok: !result.error && result.status === 0 && version !== null,
    version,
    code: result.error ? "runtime_spawn_failed" : result.status === 0 ? null : "runtime_version_failed",
  };
}

function createIsolationDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-pi-runtime-"));
  const result = {
    path: root,
    home: path.join(root, "home"),
    config: path.join(root, "config"),
    data: path.join(root, "data"),
    cache: path.join(root, "cache"),
    pi: path.join(root, "pi"),
    temporary: true,
  };
  for (const directory of Object.values(result).filter((value) => typeof value === "string")) {
    if (directory !== root) fs.mkdirSync(directory, { recursive: true });
  }
  return result;
}

async function probeAcpInitialize(hostPath, adapterEntry, env, cwd) {
  if (!fileAvailable(hostPath, true) || !fileAvailable(adapterEntry)) {
    return { ok: false, code: "acp_initialize_spawn_error", status: "not-run" };
  }
  const child = spawn(hostPath, [adapterEntry], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: "runtime-doctor-initialize",
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientInfo: { name: "harnss-runtime-doctor", version: "1" },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        promptCapabilities: { image: false, embeddedContext: false },
      },
    },
  });
  return await new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "acp_initialize_timeout", status: "timeout" }), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish({ ok: false, code: "acp_initialize_protocol_error", status: "protocol-error" });
          return;
        }
        if (message.id !== "runtime-doctor-initialize") continue;
        finish(message.result?.protocolVersion === 1
          ? { ok: true, code: null, status: "initialized", protocolVersion: 1 }
          : { ok: false, code: "acp_initialize_rejected", status: "rejected" });
        return;
      }
    });
    child.on("error", () => finish({ ok: false, code: "acp_initialize_spawn_error", status: "spawn-error" }));
    child.on("exit", (code) => finish({ ok: false, code: "acp_initialize_exit", status: "exited", exitCode: code }));
    child.stdin.end(`${request}\n`);
  });
}

function isNonEmptyCatalog(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value.data)) return value.data.length > 0;
  if (Array.isArray(value.models)) return value.models.length > 0;
  return Array.isArray(value.providers)
    && value.providers.some((provider) => Array.isArray(provider?.models) && provider.models.length > 0);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:api[-_]?key|token|secret|password|credential|auth)/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readCatalog() {
  const configuredPath = process.env.PI_RUNTIME_DOCTOR_CATALOG?.trim();
  if (configuredPath) {
    try {
      const value = JSON.parse(await fsp.readFile(path.resolve(configuredPath), "utf8"));
      return isNonEmptyCatalog(value)
        ? { ok: true, source: "file", code: null }
        : { ok: false, code: "catalog_missing" };
    } catch {
      return { ok: false, code: "catalog_missing" };
    }
  }
  const catalogUrl = safeUrl(process.env.PI_RUNTIME_DOCTOR_CATALOG_URL);
  if (!catalogUrl) return { ok: false, code: "catalog_missing" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(catalogUrl, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, code: response.status === 404 ? "catalog_missing" : "provider_unreachable" };
    return isNonEmptyCatalog(await response.json())
      ? { ok: true, source: "url", code: null }
      : { ok: false, code: "catalog_missing" };
  } catch {
    return { ok: false, code: "provider_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function checkCredentials() {
  const explicit = String(process.env.PI_RUNTIME_DOCTOR_CREDENTIAL_PRESENT ?? "").trim().toLowerCase();
  const filePath = process.env.PI_RUNTIME_DOCTOR_CREDENTIAL_FILE?.trim();
  const present = ["1", "true", "yes"].includes(explicit)
    || CREDENTIAL_KEYS.some((key) => Boolean(process.env[key]?.trim()))
    || Boolean(filePath && fs.existsSync(path.resolve(filePath)));
  return { ok: present, status: present ? "present" : "missing", code: present ? null : "credential_missing" };
}

async function checkProvider(catalog) {
  if (catalog.code === "provider_unreachable") return catalog;
  const configuredUrl = safeUrl(process.env.PI_RUNTIME_DOCTOR_PROVIDER_URL);
  if (!configuredUrl) {
    return catalog.ok
      ? { ok: true, status: "verified-with-catalog", code: null }
      : { ok: false, status: "not-configured", code: "provider_not_configured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(configuredUrl, { method: "GET", signal: controller.signal, redirect: "manual" });
    if (response.body) await response.body.cancel().catch(() => {});
    return response.ok || response.status === 401 || response.status === 403
      ? { ok: true, status: "reachable", code: null }
      : { ok: false, status: "unreachable", code: "provider_unreachable" };
  } catch {
    return { ok: false, status: "unreachable", code: "provider_unreachable", url: configuredUrl };
  } finally {
    clearTimeout(timer);
  }
}

function checkLibrary(packageName, expected) {
  try {
    const packagePath = require.resolve(`${packageName}/package.json`, { paths: [repoRoot] });
    const actualVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
    return {
      package: packageName,
      expectedVersion: expected.version,
      actualVersion,
      ok: actualVersion === expected.version,
      code: actualVersion === expected.version ? null : "library_version_mismatch",
    };
  } catch {
    return { package: packageName, expectedVersion: expected.version, actualVersion: null, ok: false, code: "library_missing" };
  }
}

async function buildResult(manifest) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const lockfile = parseYaml(fs.readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"));
  const pi = inspectBundledComponent("pi", manifest.binaries.pi, packageJson, lockfile);
  const piAcp = inspectBundledComponent("pi-acp", manifest.binaries["pi-acp"], packageJson, lockfile);
  const piMcpAdapter = inspectBundledComponent(
    "pi-mcp-adapter",
    manifest.extensions["pi-mcp-adapter"],
    packageJson,
    lockfile,
  );
  const hostPath = String(process.env.PCC_AGENT_PI_RUNTIME_HOST?.trim()
    || resolveHeadlessElectronHost(String(require("electron"))));
  const wrapperPath = path.join(repoRoot, "build", "pi-runtime", "bin", process.platform === "win32" ? "pi.cmd" : "pi");
  const mcpBridgePath = path.join(repoRoot, "build", "pi-runtime", "extensions", "pcc-mcp.ts");
  const contextExtensionPath = path.join(repoRoot, "build", "pi-runtime", "extensions", "pcc-context-usage.ts");
  const packageBootstrapPath = path.join(repoRoot, "build", "pi-runtime", "bin", "pcc-pi-package-launch.cjs");
  const isolation = createIsolationDirectory();
  const env = runtimeEnvironment(hostPath, pi.entryPath, wrapperPath, isolation);
  env.PCC_AGENT_PI_CONTEXT_EXTENSION = contextExtensionPath;
  env.PCC_AGENT_PI_PACKAGE_BOOTSTRAP = packageBootstrapPath;
  const hostVersion = runVersion(hostPath, ["--version"], env);
  const minimumNode = parseSemver(manifest.node.minimum);
  const actualNode = parseSemver(hostVersion.version);
  const runtimeHost = {
    source: "bundled-electron",
    path: hostPath,
    actualVersion: actualNode?.text ?? null,
    minimumVersion: minimumNode?.text ?? manifest.node.minimum,
    ok: Boolean(hostVersion.ok && actualNode && minimumNode && compareSemver(actualNode, minimumNode) >= 0),
    code: hostVersion.ok ? null : "pi_runtime_host_missing",
  };
  if (!runtimeHost.ok && runtimeHost.code === null) runtimeHost.code = "node_version_invalid";
  const launcher = {
    source: "bundled-resource",
    path: wrapperPath,
    available: fileAvailable(wrapperPath, true),
    version: null,
    ok: false,
    code: null,
  };
  if (!launcher.available) {
    launcher.code = "pi_bundled_wrapper_missing";
  } else {
    const version = runVersion(wrapperPath, ["--version"], env, process.platform === "win32");
    launcher.version = version.version;
    launcher.ok = version.ok && version.version === manifest.binaries.pi.version;
    launcher.code = launcher.ok ? null : "pi_bundled_wrapper_failed";
  }
  const mcpBridge = {
    source: "bundled-resource",
    path: mcpBridgePath,
    ok: fileAvailable(mcpBridgePath),
    code: fileAvailable(mcpBridgePath) ? null : "pi_mcp_bridge_missing",
  };
  const contextBridge = {
    source: "bundled-resource",
    path: contextExtensionPath,
    ok: fileAvailable(contextExtensionPath),
    code: fileAvailable(contextExtensionPath) ? null : "pi_context_bridge_missing",
  };
  const packageBootstrap = {
    source: "bundled-resource",
    path: packageBootstrapPath,
    ok: fileAvailable(packageBootstrapPath),
    code: fileAvailable(packageBootstrapPath) ? null : "pi_package_bootstrap_missing",
  };
  const piFamily = (manifest.piFamily?.packages ?? []).map((packageName) => {
    const expectedVersion = manifest.piFamily.version;
    const lockEntry = lockfile.packages?.[`${packageName}@${expectedVersion}`];
    const overridePinned = packageJson.pnpm?.overrides?.[packageName] === expectedVersion;
    const integrityPinned = typeof lockEntry?.resolution?.integrity === "string"
      && lockEntry.resolution.integrity.length > 0;
    return {
      package: packageName,
      expectedVersion,
      overridePinned,
      integrityPinned,
      ok: overridePinned && integrityPinned,
      code: overridePinned && integrityPinned ? null : "pi_family_dependency_not_pinned",
    };
  });
  const distribution = {
    ok: manifest.distribution?.mode === "bundled"
      && manifest.distribution?.firstRunDownload === false
      && manifest.distribution?.systemPathPolicy === "ignored"
      && piFamily.length > 0
      && piFamily.every((entry) => entry.ok),
    mode: manifest.distribution?.mode,
    firstRunDownload: manifest.distribution?.firstRunDownload,
    systemPathPolicy: manifest.distribution?.systemPathPolicy,
    code: null,
  };
  if (!distribution.ok) distribution.code = "runtime_distribution_contract_invalid";
  const platform = `${process.platform}-${process.arch}`;
  const platformCheck = {
    platform,
    ok: manifest.platforms.includes(platform),
    code: manifest.platforms.includes(platform) ? null : "runtime_platform_unsupported",
  };
  const catalog = await readCatalog();
  const credential = checkCredentials();
  const provider = await checkProvider(catalog);
  const acpInitialize = await probeAcpInitialize(hostPath, piAcp.entryPath, env, isolation.path);
  const libraries = Object.entries(manifest.libraries ?? {}).map(([name, expected]) => checkLibrary(name, expected));
  const checks = { runtimeHost, launcher, mcpBridge, contextBridge, packageBootstrap, distribution, platform: platformCheck, catalog, credential, provider, acpInitialize };
  const issues = [
    ...[pi, piAcp, piMcpAdapter, ...Object.values(checks), ...libraries, ...piFamily]
      .flatMap((check) => check.ok || !check.code ? [] : [check.code]),
  ];
  return {
    ok: issues.length === 0,
    manifestPath,
    source: "bundled",
    offlineReady: pi.ok
      && piAcp.ok
      && piMcpAdapter.ok
      && runtimeHost.ok
      && launcher.ok
      && mcpBridge.ok
      && contextBridge.ok
      && packageBootstrap.ok
      && distribution.ok
      && platformCheck.ok,
    binaries: [pi, piAcp, piMcpAdapter],
    piFamily,
    libraries,
    checks,
    isolation,
    issues: [...new Set(issues)],
  };
}

function formatHumanResult(result) {
  const lines = [`Pi runtime doctor: ${result.ok ? "OK" : "FAIL"}`];
  lines.push(`Distribution: ${result.source} | offlineReady=${result.offlineReady}`);
  for (const binary of result.binaries) {
    lines.push(`${binary.binary}: ${binary.ok ? "OK" : "FAIL"} | source=${binary.source} | version=${binary.actualVersion ?? "n/a"} | expected=${binary.expectedVersion}${binary.code ? ` | code=${binary.code}` : ""}`);
  }
  for (const [name, check] of Object.entries(result.checks)) {
    lines.push(`${name}: ${check.ok ? "OK" : `FAIL | code=${check.code}`}`);
  }
  if (result.issues.length) lines.push(`Issues: ${result.issues.join(", ")}`);
  return lines.join("\n");
}

let result;
try {
  result = await buildResult(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
} catch (error) {
  result = {
    ok: false,
    manifestPath,
    issues: ["manifest_error"],
    error: { code: "manifest_error", message: error instanceof Error ? error.message : "runtime manifest could not be read" },
  };
}

process.stdout.write(jsonOutput
  ? `${JSON.stringify(result, null, 2)}\n`
  : `${result.error ? `Pi runtime doctor: FAIL\n${result.error.message}` : formatHumanResult(result)}\n`);
if (result.isolation?.temporary && result.isolation.path) {
  fs.rmSync(result.isolation.path, { recursive: true, force: true });
}
if (!result.ok) process.exitCode = 1;
