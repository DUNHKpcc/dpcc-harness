import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { getDataDir } from "./data-dir";
import { resolveBundledPiRuntime } from "./bundled-pi-runtime";
import { JsonFileStore } from "./json-file-store";
import { gitExec } from "./git-exec";
import type {
  InstalledPiPackageRecord,
  PiPackageInstallRequest,
  PiPackageResource,
  PiPackageResourceKind,
  PiPackageStatus,
} from "../../../shared/types/plugins";

const PACKAGE_ROOT_SEGMENTS = ["plugins", "pi-packages"];
const MAX_PACKAGE_RESOURCES = 500;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const NPM_SOURCE_PATTERN = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i;
const GIT_SOURCE_PATTERN = /^git:(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/;
const RESOURCE_KINDS: PiPackageResourceKind[] = ["extensions", "skills", "prompts", "themes"];

interface PackageManagerResource {
  path: string;
  enabled: boolean;
  metadata?: {
    origin?: "package" | "top-level";
    source?: string;
    scope?: "user" | "project" | "temporary";
    baseDir?: string;
  };
}

interface PackageManagerResolvedPaths {
  extensions: PackageManagerResource[];
  skills: PackageManagerResource[];
  prompts: PackageManagerResource[];
  themes: PackageManagerResource[];
}

interface PiSettingsManager {
  flush: () => Promise<void>;
}

interface PiPackageManager {
  installAndPersist: (source: string, options?: { local?: boolean }) => Promise<void>;
  removeAndPersist: (source: string, options?: { local?: boolean }) => Promise<boolean>;
  resolve: (onMissing?: (source: string) => Promise<"skip">) => Promise<PackageManagerResolvedPaths>;
  getInstalledPath: (source: string, scope: "user" | "project") => string | undefined;
}

interface PiPackageRuntimeModules {
  SettingsManager: {
    create: (cwd: string, agentDir: string, options?: { projectTrusted?: boolean }) => PiSettingsManager;
  };
  DefaultPackageManager: new (options: {
    cwd: string;
    agentDir: string;
    settingsManager: PiSettingsManager;
  }) => PiPackageManager;
}

interface ParsedPiPackageSource {
  source: string;
  id: string;
  reviewUrl: string;
}

export interface PiPackageLaunchResources {
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

const manifestStore = new JsonFileStore<InstalledPiPackageRecord[]>({
  subDir: "plugins/pi-packages",
  label: "PI_PACKAGE_MANIFEST",
});

let pendingOperation: Promise<void> = Promise.resolve();

function packageRoot(): string {
  const root = path.join(getDataDir(), ...PACKAGE_ROOT_SEGMENTS);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function packageAgentDir(): string {
  const agentDir = path.join(packageRoot(), "agent");
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  return agentDir;
}

function userPiAgentDir(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

function sourceId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathIsInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_PACKAGE_MANIFEST_BYTES) {
    throw new Error("Pi package manifest exceeds the size limit");
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Pi package manifest is invalid");
  }
  return parsed as Record<string, unknown>;
}

function packageMetadata(installPath: string): { name: string; version?: string } {
  const fallback = path.basename(installPath);
  try {
    const manifest = readJsonObject(path.join(installPath, "package.json"));
    const name = typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim()
      : fallback;
    const version = typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : undefined;
    return { name, version };
  } catch {
    return { name: fallback };
  }
}

function collectPackageResources(
  resolved: PackageManagerResolvedPaths,
  installPath: string,
): PiPackageResource[] {
  const canonicalRoot = fs.realpathSync(installPath);
  const resources: PiPackageResource[] = [];
  const seen = new Set<string>();

  for (const kind of RESOURCE_KINDS) {
    for (const resource of resolved[kind] ?? []) {
      if (
        resource.enabled !== true
        || resource.metadata?.origin !== "package"
        || resources.length >= MAX_PACKAGE_RESOURCES
      ) continue;
      try {
        const canonicalPath = fs.realpathSync(resource.path);
        if (!pathIsInside(canonicalPath, canonicalRoot) || !fs.statSync(canonicalPath).isFile()) continue;
        const key = `${kind}:${canonicalPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resources.push({
          kind,
          path: canonicalPath,
          relativePath: path.relative(canonicalRoot, canonicalPath),
        });
      } catch {
        // Pi ignores a resource that vanishes while resolving; mirror that behavior in the manifest.
      }
    }
  }
  return resources;
}

function recordStatus(record: InstalledPiPackageRecord): PiPackageStatus {
  if (!record.enabled) return "disabled";
  try {
    const canonicalRoot = fs.realpathSync(record.installPath);
    const hasAvailableResource = record.resources.some((resource) => {
      if (resource.enabled === false) return false;
      try {
        const canonicalPath = fs.realpathSync(resource.path);
        return pathIsInside(canonicalPath, canonicalRoot) && fs.statSync(canonicalPath).isFile();
      } catch {
        return false;
      }
    });
    return hasAvailableResource ? "ready" : "missing";
  } catch {
    return "missing";
  }
}

function loadManifest(): InstalledPiPackageRecord[] {
  return manifestStore.load("manifest") ?? [];
}

function saveManifest(records: InstalledPiPackageRecord[]): void {
  manifestStore.save("manifest", records);
}

function asListedRecord(record: InstalledPiPackageRecord): InstalledPiPackageRecord {
  return {
    ...record,
    managed: record.managed !== false,
    origin: record.origin ?? "pcc-agent",
    status: recordStatus(record),
    resources: [...record.resources],
  };
}

async function withPackageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = pendingOperation;
  let release!: () => void;
  pendingOperation = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function loadPiPackageRuntimeModules(): Promise<PiPackageRuntimeModules> {
  const runtime = resolveBundledPiRuntime();
  const packageRootPath = runtime.pi.packageRoot;
  if (!packageRootPath) throw new Error("The bundled Pi package root is unavailable");

  const [settingsModule, packageManagerModule] = await Promise.all([
    import(pathToFileURL(path.join(packageRootPath, "dist", "core", "settings-manager.js")).href),
    import(pathToFileURL(path.join(packageRootPath, "dist", "core", "package-manager.js")).href),
  ]);
  if (
    typeof settingsModule.SettingsManager?.create !== "function"
    || typeof packageManagerModule.DefaultPackageManager !== "function"
  ) {
    throw new Error("The bundled Pi package manager is unavailable");
  }
  return {
    SettingsManager: settingsModule.SettingsManager as PiPackageRuntimeModules["SettingsManager"],
    DefaultPackageManager: packageManagerModule.DefaultPackageManager as PiPackageRuntimeModules["DefaultPackageManager"],
  };
}

async function createPackageManager(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): Promise<{
  manager: PiPackageManager;
  settingsManager: PiSettingsManager;
}> {
  const { SettingsManager, DefaultPackageManager } = await loadPiPackageRuntimeModules();
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: options.projectTrusted,
  });
  return {
    settingsManager,
    manager: new DefaultPackageManager({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
    }),
  };
}

async function createManagedPackageManager() {
  const root = packageRoot();
  return createPackageManager({
    cwd: root,
    agentDir: packageAgentDir(),
    projectTrusted: true,
  });
}

async function gitRevision(installPath: string): Promise<string | undefined> {
  try {
    return (await gitExec(["rev-parse", "HEAD"], installPath)).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Only explicit, immutable-looking user-scoped package sources are accepted in v1. */
export function normalizePiPackageInstallRequest(
  request: PiPackageInstallRequest,
): ParsedPiPackageSource {
  if (request.reviewed !== true) {
    throw new Error("Review the package source and acknowledge its execution risk before installing");
  }
  const source = request.source.trim();
  const npm = source.match(NPM_SOURCE_PATTERN);
  if (npm) {
    const [, packageName, version] = npm;
    return {
      source,
      id: sourceId(`npm:${packageName.toLowerCase()}`),
      reviewUrl: `https://www.npmjs.com/package/${encodeURIComponent(packageName)}/v/${encodeURIComponent(version)}`,
    };
  }
  const git = source.match(GIT_SOURCE_PATTERN);
  if (git) {
    const [, repository, ref] = git;
    return {
      source,
      id: sourceId(`git:${repository.toLowerCase()}`),
      reviewUrl: `https://${repository}/tree/${encodeURIComponent(ref)}`,
    };
  }
  throw new Error("Use an exact npm package version or a pinned GitHub git source");
}

function resolvedUserResourceRecords(
  resolved: PackageManagerResolvedPaths,
  agentDir: string,
): InstalledPiPackageRecord[] {
  const records = new Map<string, InstalledPiPackageRecord>();
  let canonicalAgentDir: string | null = null;
  try {
    canonicalAgentDir = fs.realpathSync(agentDir);
  } catch {
    return [];
  }

  for (const kind of RESOURCE_KINDS) {
    for (const resource of resolved[kind] ?? []) {
      const metadata = resource.metadata;
      if (!metadata || metadata.scope !== "user") continue;
      try {
        const canonicalPath = fs.realpathSync(resource.path);
        if (!fs.statSync(canonicalPath).isFile()) continue;

        const isPackageResource = metadata.origin === "package";
        const isInsideUserPi = pathIsInside(canonicalPath, canonicalAgentDir);
        const isExplicitLocalResource = metadata.origin === "top-level" && metadata.source !== "auto";
        if (!isPackageResource && !isExplicitLocalResource && !isInsideUserPi) {
          // ~/.agents Skills are already handled by the dedicated managed Skill path.
          continue;
        }

        let installPath = path.dirname(canonicalPath);
        if (isPackageResource && metadata.baseDir) {
          try {
            const packageRoot = fs.realpathSync(metadata.baseDir);
            if (pathIsInside(canonicalPath, packageRoot)) installPath = packageRoot;
          } catch {
            // Keep the individual file root if a package was modified while scanning.
          }
        }

        const source = isPackageResource && metadata.source?.trim()
          ? metadata.source.trim()
          : `local:${canonicalPath}`;
        const key = isPackageResource
          ? `user-package:${source}:${installPath}`
          : `user-local:${canonicalPath}`;
        const existing = records.get(key);
        const timestamp = new Date(fs.statSync(canonicalPath).mtimeMs).toISOString();
        const packageInfo = isPackageResource ? packageMetadata(installPath) : undefined;
        const record = existing ?? {
          id: `user-pi-${sourceId(key)}`,
          source,
          name: packageInfo?.name ?? path.basename(canonicalPath),
          ...(packageInfo?.version ? { version: packageInfo.version } : {}),
          installPath,
          resources: [],
          enabled: false,
          status: "disabled" as const,
          installedAt: timestamp,
          updatedAt: timestamp,
          managed: false,
          origin: "user-pi" as const,
        };
        if (record.resources.length >= MAX_PACKAGE_RESOURCES) continue;
        const duplicate = record.resources.some((entry) => entry.kind === kind && entry.path === canonicalPath);
        if (!duplicate) {
          record.resources.push({
            kind,
            path: canonicalPath,
            relativePath: path.relative(installPath, canonicalPath) || path.basename(canonicalPath),
            enabled: resource.enabled === true,
          });
        }
        record.enabled ||= resource.enabled === true;
        if (timestamp > record.updatedAt) record.updatedAt = timestamp;
        records.set(key, record);
      } catch {
        // User Pi configuration is read-only input; a changing resource is skipped.
      }
    }
  }
  return [...records.values()].map(asListedRecord);
}

/** Read existing ~/.pi resources with Pi's resolver without installing or rewriting anything. */
export async function discoverUserPiPackages(
  agentDir = userPiAgentDir(),
): Promise<InstalledPiPackageRecord[]> {
  if (!fs.existsSync(agentDir)) return [];
  try {
    const { manager } = await createPackageManager({
      cwd: agentDir,
      agentDir,
      projectTrusted: false,
    });
    const resolved = await manager.resolve(async () => "skip");
    return resolvedUserResourceRecords(resolved, agentDir);
  } catch {
    // Existing Pi configuration is optional compatibility input and must never block PccAgent.
    return [];
  }
}

export async function listInstalledPiPackages(): Promise<InstalledPiPackageRecord[]> {
  const discovered = await discoverUserPiPackages();
  return [...loadManifest().map(asListedRecord), ...discovered]
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function installPiPackage(
  request: PiPackageInstallRequest,
): Promise<InstalledPiPackageRecord> {
  const parsed = normalizePiPackageInstallRequest(request);
  return withPackageOperation(async () => {
    const { manager, settingsManager } = await createManagedPackageManager();
    await manager.installAndPersist(parsed.source);
    await settingsManager.flush();

    const installPath = manager.getInstalledPath(parsed.source, "user");
    if (!installPath) {
      throw new Error("Pi package installation completed without an installed package path");
    }
    const resources = collectPackageResources(await manager.resolve(), installPath);
    if (resources.length === 0) {
      await manager.removeAndPersist(parsed.source);
      await settingsManager.flush();
      throw new Error("The package does not expose any Pi extensions, Skills, prompts, or themes");
    }

    const previousRecords = loadManifest();
    const previous = previousRecords.find((record) => record.id === parsed.id);
    const metadata = packageMetadata(installPath);
    const now = new Date().toISOString();
    const record: InstalledPiPackageRecord = {
      id: parsed.id,
      source: parsed.source,
      name: metadata.name,
      ...(metadata.version ? { version: metadata.version } : {}),
      ...(parsed.source.startsWith("git:") ? { sourceRevision: await gitRevision(installPath) } : {}),
      reviewUrl: parsed.reviewUrl,
      installPath: fs.realpathSync(installPath),
      resources,
      enabled: previous?.enabled ?? true,
      status: "ready",
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      managed: true,
      origin: "pcc-agent",
    };
    saveManifest([...previousRecords.filter((item) => item.id !== record.id), record]);
    return asListedRecord(record);
  });
}

export async function setPiPackageEnabled(
  id: string,
  enabled: boolean,
): Promise<InstalledPiPackageRecord> {
  return withPackageOperation(async () => {
    const records = loadManifest();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error("Pi package record not found");
    const next = { ...record, enabled, updatedAt: new Date().toISOString() };
    saveManifest(records.map((item) => item.id === id ? next : item));
    return asListedRecord(next);
  });
}

export async function removePiPackage(id: string): Promise<void> {
  await withPackageOperation(async () => {
    const records = loadManifest();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error("Pi package record not found");
    const { manager, settingsManager } = await createManagedPackageManager();
    await manager.removeAndPersist(record.source);
    await settingsManager.flush();
    // A previous interrupted install can leave a stale PccAgent manifest after
    // Pi has already removed its own setting. Clearing the manifest is safe:
    // only manifest-backed resources are injected at launch.
    saveManifest(records.filter((item) => item.id !== id));
  });
}

function collectPiLaunchResources(records: InstalledPiPackageRecord[]): PiPackageLaunchResources {
  const result: PiPackageLaunchResources = {
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.enabled || recordStatus(record) !== "ready") continue;
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync(record.installPath);
    } catch {
      continue;
    }
    for (const resource of record.resources) {
      if (resource.enabled === false) continue;
      try {
        const canonicalPath = fs.realpathSync(resource.path);
        const key = `${resource.kind}:${canonicalPath}`;
        if (
          !RESOURCE_KINDS.includes(resource.kind)
          || seen.has(key)
          || !pathIsInside(canonicalPath, canonicalRoot)
          || !fs.statSync(canonicalPath).isFile()
        ) continue;
        seen.add(key);
        result[resource.kind].push(canonicalPath);
      } catch {
        // A changed or removed package resource is intentionally skipped at launch.
      }
    }
  }
  return result;
}

/**
 * Resolve PccAgent-managed packages and the user's existing Pi configuration
 * into explicit resource paths for the protected bundled Pi launch.
 */
export async function getPiPackageLaunchResources(
  records?: InstalledPiPackageRecord[],
): Promise<PiPackageLaunchResources> {
  const sourceRecords = records ?? [...loadManifest(), ...await discoverUserPiPackages()];
  return collectPiLaunchResources(sourceRecords);
}
