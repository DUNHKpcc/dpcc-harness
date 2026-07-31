import { createHash } from "crypto";
import { JsonFileStore } from "./json-file-store";
import type {
  CatalogResult,
  McpCatalogInput,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpCatalogInstallRequest,
  McpCatalogInstallResult,
  SkillCatalogItem,
} from "../../../shared/types/plugins";

const SKILLS_CATALOG_BASE_URL =
  process.env.PCC_SKILLS_CATALOG_BASE_URL?.replace(/\/+$/, "") ?? "https://skills.sh";
const MCP_REGISTRY_BASE_URL =
  process.env.PCC_MCP_REGISTRY_BASE_URL?.replace(/\/+$/, "") ??
  "https://registry.modelcontextprotocol.io/v0.1";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const CATALOG_FRESH_TTL_MS = 5 * 60 * 1000;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const PACKAGE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SKILL_SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SKILL_CATALOG_LIMIT = 30;
const MCP_CATALOG_LIMIT = 50;
const RASTER_ICON_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const TRUSTED_ICON_HOSTS = new Set([
  "github.com",
  "avatars.githubusercontent.com",
  "raw.githubusercontent.com",
]);

interface CachedCatalog<T> {
  items: T[];
  fetchedAt: string;
}

const skillCache = new JsonFileStore<CachedCatalog<SkillCatalogItem>>({
  subDir: "plugins/catalog-cache/skills",
  label: "SKILL_CATALOG_CACHE",
});

const mcpCache = new JsonFileStore<CachedCatalog<McpCatalogItem>>({
  subDir: "plugins/catalog-cache/mcp",
  label: "MCP_CATALOG_CACHE",
});

const skillRequests = new Map<string, Promise<CatalogResult<SkillCatalogItem>>>();
const mcpRequests = new Map<string, Promise<CatalogResult<McpCatalogItem>>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function cacheKey(query: string): string {
  return createHash("sha256").update(query.trim().toLowerCase()).digest("hex");
}

function isFreshCatalog<T>(cached: CachedCatalog<T> | null, now = Date.now()): cached is CachedCatalog<T> {
  if (!cached || !Array.isArray(cached.items) || typeof cached.fetchedAt !== "string") return false;
  const fetchedAt = Date.parse(cached.fetchedAt);
  const age = now - fetchedAt;
  return Number.isFinite(fetchedAt) && age >= 0 && age < CATALOG_FRESH_TTL_MS;
}

function dedupeCatalogRequest<T>(
  requests: Map<string, Promise<CatalogResult<T>>>,
  key: string,
  load: () => Promise<CatalogResult<T>>,
): Promise<CatalogResult<T>> {
  const existing = requests.get(key);
  if (existing) return existing;

  const request = load().finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}

function isAllowedCatalogUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch {
    return false;
  }
}

function githubAvatarUrl(source: string): string | undefined {
  if (!SKILL_SOURCE_PATTERN.test(source)) return undefined;
  const [owner] = source.split("/");
  return `https://github.com/${encodeURIComponent(owner)}.png?size=80`;
}

function githubAvatarFromRepository(repositoryUrl: string | undefined): string | undefined {
  if (!repositoryUrl) return undefined;
  try {
    const url = new URL(repositoryUrl);
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)) {
      return undefined;
    }
    const [owner] = url.pathname.split("/").filter(Boolean);
    return owner ? `https://github.com/${encodeURIComponent(owner)}.png?size=80` : undefined;
  } catch {
    return undefined;
  }
}

function normalizedHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function iconHostIsTrusted(hostname: string, relatedHosts: Set<string>): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  if (TRUSTED_ICON_HOSTS.has(normalized)) return true;
  return Array.from(relatedHosts).some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

function normalizeMcpIconUrl(
  server: Record<string, unknown>,
  repositoryUrl: string | undefined,
): string | undefined {
  const relatedHosts = new Set<string>();
  const websiteHost = normalizedHost(stringValue(server.websiteUrl));
  const repositoryHost = normalizedHost(repositoryUrl);
  if (websiteHost) relatedHosts.add(websiteHost);
  if (repositoryHost) relatedHosts.add(repositoryHost);
  if (Array.isArray(server.remotes)) {
    for (const remote of server.remotes) {
      if (!isRecord(remote)) continue;
      const remoteHost = normalizedHost(stringValue(remote.url));
      if (remoteHost) relatedHosts.add(remoteHost);
    }
  }

  if (Array.isArray(server.icons)) {
    const icons = server.icons
      .filter(isRecord)
      .sort((left, right) => Number(Boolean(left.theme)) - Number(Boolean(right.theme)));
    for (const icon of icons) {
      const src = stringValue(icon.src);
      const mimeType = stringValue(icon.mimeType)?.toLowerCase();
      if (!src || (mimeType && !RASTER_ICON_MIME_TYPES.has(mimeType))) continue;

      try {
        const url = new URL(src);
        if (
          url.protocol !== "https:"
          || url.pathname.toLowerCase().endsWith(".svg")
          || !iconHostIsTrusted(url.hostname, relatedHosts)
        ) {
          continue;
        }
        return url.toString();
      } catch {
        continue;
      }
    }
  }

  return githubAvatarFromRepository(repositoryUrl);
}

async function fetchText(url: string, accept: string): Promise<string> {
  if (!isAllowedCatalogUrl(url)) throw new Error("Catalog URL must use HTTPS");
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Catalog request timed out"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          headers: { Accept: accept },
          signal: controller.signal,
        });
        if (!isAllowedCatalogUrl(response.url)) throw new Error("Catalog redirect must use HTTPS");
        if (!response.ok) {
          throw new Error(`Catalog request failed with HTTP ${response.status}`);
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          throw new Error("Catalog response exceeds the size limit");
        }

        if (!response.body) throw new Error("Catalog response has no body");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Catalog response exceeds the size limit");
          }
          chunks.push(value);
        }
        return Buffer.concat(
          chunks.map((chunk) => Buffer.from(chunk)),
          receivedBytes,
        ).toString("utf8");
      })(),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url, "application/json")) as unknown;
}

function catalogResult<T>(
  items: T[],
  source: string,
  fetchedAt: string,
  freshness: "fresh" | "stale",
): CatalogResult<T> {
  return { items, source, fetchedAt, freshness };
}

export function normalizeSkillSearchResponse(payload: unknown): SkillCatalogItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) return [];

  return payload.skills.flatMap((entry): SkillCatalogItem[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const name = stringValue(entry.name);
    const source = stringValue(entry.source);
    if (!id || !name || !source) return [];

    return [{
      id,
      name,
      source,
      installs: numberValue(entry.installs),
      url: `https://skills.sh/${id}`,
      iconUrl: githubAvatarUrl(source),
      installable: SKILL_SOURCE_PATTERN.test(source),
    }];
  });
}

function parseCompactInstallCount(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(value.trim().replaceAll(",", "").toUpperCase());
  if (!match) return null;

  const count = Number(match[1]);
  if (!Number.isFinite(count)) return null;
  const multiplier = match[2] === "K"
    ? 1_000
    : match[2] === "M"
      ? 1_000_000
      : match[2] === "B"
        ? 1_000_000_000
        : 1;
  return Math.round(count * multiplier);
}

export async function normalizeSkillLeaderboardHtml(
  html: string,
  catalogBaseUrl = SKILLS_CATALOG_BASE_URL,
): Promise<SkillCatalogItem[]> {
  const { parse } = await import("node-html-parser");
  const root = parse(html);
  const baseUrl = new URL(`${catalogBaseUrl.replace(/\/+$/, "")}/`);
  const items = new Map<string, SkillCatalogItem>();

  for (const anchor of root.querySelectorAll("a[href]")) {
    if (items.size >= SKILL_CATALOG_LIMIT) break;

    const href = anchor.getAttribute("href");
    const name = stringValue(anchor.querySelector("h3")?.text);
    const source = stringValue(anchor.querySelector("p")?.text);
    if (!href?.startsWith("/") || href.startsWith("//") || !name || !source) continue;

    let itemUrl: URL;
    let itemPath: string;
    try {
      itemUrl = new URL(href, baseUrl);
      itemPath = decodeURIComponent(itemUrl.pathname).replace(/^\/+|\/+$/g, "");
    } catch {
      continue;
    }
    if (itemUrl.origin !== baseUrl.origin || itemPath !== `${source}/${name}`) continue;

    let installs = 0;
    const spans = anchor.querySelectorAll("span");
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      const parsed = parseCompactInstallCount(spans[index].text);
      if (parsed !== null) {
        installs = parsed;
        break;
      }
    }

    const id = `${source}/${name}`;
    if (items.has(id)) continue;
    items.set(id, {
      id,
      name,
      source,
      installs,
      url: itemUrl.toString(),
      iconUrl: githubAvatarUrl(source),
      installable: SKILL_SOURCE_PATTERN.test(source),
    });
  }

  return Array.from(items.values());
}

function normalizeInput(
  key: string,
  value: unknown,
  target: McpCatalogInput["target"],
): McpCatalogInput {
  const definition = isRecord(value) ? value : {};
  const secret = booleanValue(definition.isSecret);
  const defaultValue = secret
    ? undefined
    : stringValue(definition.default) ?? stringValue(definition.value);
  return {
    key,
    label: stringValue(definition.description) ?? key,
    description: stringValue(definition.description),
    required: booleanValue(definition.isRequired),
    secret,
    ...(defaultValue ? { defaultValue } : {}),
    target,
  };
}

function normalizeRemoteOptions(server: Record<string, unknown>): McpCatalogInstallOption[] {
  if (!Array.isArray(server.remotes)) return [];

  return server.remotes.flatMap((remote, index): McpCatalogInstallOption[] => {
    if (!isRecord(remote)) return [];
    const rawType = stringValue(remote.type);
    const urlTemplate = stringValue(remote.url);
    if (!rawType || !urlTemplate) return [];

    const transport = rawType === "streamable-http"
      ? "http"
      : rawType === "sse"
        ? "sse"
        : null;
    if (!transport) return [];

    const inputs: McpCatalogInput[] = [];
    if (isRecord(remote.variables)) {
      for (const [key, value] of Object.entries(remote.variables)) {
        inputs.push(normalizeInput(key, value, "url"));
      }
    }
    if (Array.isArray(remote.headers)) {
      for (const header of remote.headers) {
        if (!isRecord(header)) continue;
        const name = stringValue(header.name);
        if (!name) continue;
        inputs.push(normalizeInput(name, header, "header"));
      }
    }

    const usesHttps = urlTemplate.startsWith("https://");
    const hasPlaintextSecret = inputs.some((input) => input.secret);
    return [{
      id: `remote:${index}`,
      kind: "remote",
      transport,
      label: transport === "http" ? "Streamable HTTP" : "SSE",
      supported: usesHttps && !hasPlaintextSecret,
      urlTemplate,
      inputs,
    }];
  });
}

function normalizePackageOptions(server: Record<string, unknown>): McpCatalogInstallOption[] {
  if (!Array.isArray(server.packages)) return [];

  return server.packages.flatMap((pkg, index): McpCatalogInstallOption[] => {
    if (!isRecord(pkg)) return [];
    const registryType = stringValue(pkg.registryType);
    const packageName = stringValue(pkg.identifier);
    const packageVersion = stringValue(pkg.version);
    const transportValue = isRecord(pkg.transport) ? stringValue(pkg.transport.type) : undefined;
    if (!registryType || !packageName) return [];

    const inputs: McpCatalogInput[] = [];
    if (Array.isArray(pkg.environmentVariables)) {
      for (const variable of pkg.environmentVariables) {
        if (!isRecord(variable)) continue;
        const name = stringValue(variable.name);
        if (!name) continue;
        inputs.push(normalizeInput(name, variable, "env"));
      }
    }
    if (Array.isArray(pkg.packageArguments)) {
      for (const [argumentIndex, argument] of pkg.packageArguments.entries()) {
        if (!isRecord(argument)) continue;
        const argumentType = stringValue(argument.type);
        if (argumentType !== "named" && argumentType !== "positional") continue;
        const argumentName = stringValue(argument.name);
        const key = argumentName ?? `argument-${argumentIndex + 1}`;
        inputs.push({
          ...normalizeInput(key, argument, "arg"),
          argumentType,
          argumentName,
        });
      }
    }

    const supported =
      registryType === "npm" &&
      transportValue === "stdio" &&
      !inputs.some((input) => input.secret);
    return [{
      id: `${registryType}:${index}`,
      kind: "npm",
      transport: "stdio",
      label: registryType === "npm" ? "npm / stdio" : `${registryType} / stdio`,
      supported,
      packageName,
      packageVersion,
      inputs,
    }];
  });
}

export function normalizeMcpRegistryResponse(payload: unknown): McpCatalogItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.servers)) return [];

  const items = new Map<string, McpCatalogItem>();
  for (const entry of payload.servers) {
    if (!isRecord(entry) || !isRecord(entry.server)) continue;
    const server = entry.server;
    const name = stringValue(server.name);
    const version = stringValue(server.version);
    if (!name || !version || items.has(name)) continue;

    const repositoryUrl = isRecord(server.repository)
      ? stringValue(server.repository.url)
      : undefined;
    items.set(name, {
      id: name,
      name,
      title: stringValue(server.title) ?? name,
      description: stringValue(server.description) ?? "",
      version,
      iconUrl: normalizeMcpIconUrl(server, repositoryUrl),
      repositoryUrl,
      installOptions: [
        ...normalizeRemoteOptions(server),
        ...normalizePackageOptions(server),
      ],
    });
  }

  return Array.from(items.values());
}

export async function searchSkillCatalog(query: string): Promise<CatalogResult<SkillCatalogItem>> {
  const normalizedQuery = query.trim().slice(0, 200);
  const source = "skills.sh";
  const isBrowsing = normalizedQuery.length < 2;

  const key = cacheKey(isBrowsing ? "browse:trending" : `search:${normalizedQuery}`);
  const cached = skillCache.load(key);
  if (isFreshCatalog(cached)) {
    return catalogResult(cached.items, source, cached.fetchedAt, "fresh");
  }

  return dedupeCatalogRequest(skillRequests, key, async () => {
    try {
      let items: SkillCatalogItem[];
      if (isBrowsing) {
        const html = await fetchText(`${SKILLS_CATALOG_BASE_URL}/trending`, "text/html");
        items = await normalizeSkillLeaderboardHtml(html);
        if (items.length === 0) throw new Error("Skills catalog returned no trending entries");
      } else {
        const url = new URL(`${SKILLS_CATALOG_BASE_URL}/api/search`);
        url.searchParams.set("q", normalizedQuery);
        url.searchParams.set("limit", String(SKILL_CATALOG_LIMIT));
        items = normalizeSkillSearchResponse(await fetchJson(url.toString()));
      }
      const fetchedAt = new Date().toISOString();
      skillCache.save(key, { items, fetchedAt });
      return catalogResult(items, source, fetchedAt, "fresh");
    } catch (error) {
      const fallback = cached ?? skillCache.load(key);
      if (fallback) return catalogResult(fallback.items, source, fallback.fetchedAt, "stale");
      throw error;
    }
  });
}

export async function searchMcpCatalog(query: string): Promise<CatalogResult<McpCatalogItem>> {
  const normalizedQuery = query.trim().slice(0, 200);
  const source = "Official MCP Registry";
  const key = cacheKey(normalizedQuery || "all");

  const cached = mcpCache.load(key);
  if (isFreshCatalog(cached)) {
    return catalogResult(cached.items, source, cached.fetchedAt, "fresh");
  }

  return dedupeCatalogRequest(mcpRequests, key, async () => {
    try {
      const url = new URL(`${MCP_REGISTRY_BASE_URL}/servers`);
      url.searchParams.set("limit", String(MCP_CATALOG_LIMIT));
      url.searchParams.set("version", "latest");
      if (normalizedQuery) url.searchParams.set("search", normalizedQuery);
      const items = normalizeMcpRegistryResponse(await fetchJson(url.toString()));
      const fetchedAt = new Date().toISOString();
      mcpCache.save(key, { items, fetchedAt });
      return catalogResult(items, source, fetchedAt, "fresh");
    } catch (error) {
      const fallback = cached ?? mcpCache.load(key);
      if (fallback) return catalogResult(fallback.items, source, fallback.fetchedAt, "stale");
      throw error;
    }
  });
}

function inputValue(input: McpCatalogInput, values: Record<string, string>): string {
  return values[input.key]?.trim() || input.defaultValue?.trim() || "";
}

export function resolveMcpCatalogInstall(
  request: McpCatalogInstallRequest,
): McpCatalogInstallResult {
  const option = request.item.installOptions.find((candidate) => candidate.id === request.optionId);
  if (!option) return { ok: false, error: "Install option not found" };
  if (!option.supported) return { ok: false, error: "This install option is not supported" };
  if (!SERVER_NAME_PATTERN.test(request.item.name)) {
    return { ok: false, error: "Invalid MCP server name" };
  }

  for (const input of option.inputs) {
    if (input.required && !inputValue(input, request.values)) {
      return { ok: false, error: `Missing required value: ${input.key}` };
    }
    if (input.secret) {
      return { ok: false, error: "Secret-backed MCP fields are not enabled yet" };
    }
    if (input.target === "env" && !ENV_NAME_PATTERN.test(input.key)) {
      return { ok: false, error: `Invalid environment variable name: ${input.key}` };
    }
    if (input.target === "header" && !HEADER_NAME_PATTERN.test(input.key)) {
      return { ok: false, error: `Invalid HTTP header name: ${input.key}` };
    }
    if (
      input.target === "arg"
      && input.argumentType === "named"
      && (!input.argumentName || !/^[A-Za-z0-9][A-Za-z0-9._-]*$|^--?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.argumentName))
    ) {
      return { ok: false, error: `Invalid package argument name: ${input.argumentName ?? input.key}` };
    }
  }

  if (option.kind === "remote" && option.urlTemplate) {
    let url = option.urlTemplate;
    const headers: Record<string, string> = {};
    for (const input of option.inputs) {
      const value = inputValue(input, request.values);
      if (input.target === "url") {
        url = url.replaceAll(`{${input.key}}`, encodeURIComponent(value));
      } else if (input.target === "header" && value) {
        headers[input.key] = value;
      }
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, error: "The remote URL is invalid" };
    }
    if (parsedUrl.protocol !== "https:" || /\{[^}]+\}/.test(url)) {
      return { ok: false, error: "The remote URL is incomplete or is not HTTPS" };
    }
    return {
      ok: true,
      server: {
        name: request.item.name,
        transport: option.transport === "sse" ? "sse" : "http",
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    };
  }

  if (option.kind === "npm" && option.packageName) {
    if (!NPM_PACKAGE_PATTERN.test(option.packageName)) {
      return { ok: false, error: "Invalid npm package name" };
    }
    if (option.packageVersion && !PACKAGE_VERSION_PATTERN.test(option.packageVersion)) {
      return { ok: false, error: "Invalid npm package version" };
    }
    const env: Record<string, string> = {};
    const packageArgs: string[] = [];
    for (const input of option.inputs) {
      const value = inputValue(input, request.values);
      if (input.target === "env" && value) env[input.key] = value;
      if (input.target === "arg" && value) {
        if (input.argumentType === "named" && input.argumentName) {
          const name = input.argumentName.startsWith("-")
            ? input.argumentName
            : `--${input.argumentName}`;
          if (value === "false") continue;
          packageArgs.push(name);
          if (value !== "true") packageArgs.push(value);
        } else {
          packageArgs.push(value);
        }
      }
    }
    const packageRef = option.packageVersion
      ? `${option.packageName}@${option.packageVersion}`
      : option.packageName;
    return {
      ok: true,
      server: {
        name: request.item.name,
        transport: "stdio",
        command: "npx",
        args: [
          "-y",
          packageRef,
          ...packageArgs,
        ],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    };
  }

  return { ok: false, error: "Install option is incomplete" };
}
