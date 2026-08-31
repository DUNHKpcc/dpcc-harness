#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parse: parseYaml } = require("yaml");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.HARNSS_WORKFLOW_ROOT || path.join(scriptDir, "../.."));
const stateDir = path.resolve(
  process.env.HARNSS_WORKFLOW_STATE_DIR || path.join(root, ".harnss/agent-workflow"),
);
const manifestPath = path.join(scriptDir, "pi-reference.json");
const benchmarkPath = path.join(scriptDir, "pi-reference-benchmark.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const manifest = readJson(manifestPath);

function normalizeRepository(value) {
  const raw = typeof value === "string" ? value : value?.url || "";
  return raw.replace(/^git\+/, "").replace(/\/$/, "");
}

function packageRoot(packageName) {
  return path.join(root, "node_modules", ...packageName.split("/"));
}

function packageManifest(packageName) {
  return readJson(path.join(packageRoot(packageName), "package.json"));
}

function runtimeVersionFor(source, runtimeManifest) {
  if (source.id === "pi") return runtimeManifest.binaries?.pi?.version;
  if (source.id === "pi-acp") return runtimeManifest.binaries?.["pi-acp"]?.version;
  if (source.id === "pi-mcp-adapter") return runtimeManifest.extensions?.["pi-mcp-adapter"]?.version;
  return undefined;
}

function validate() {
  const errors = [];
  const warnings = [];
  const packageJson = readJson(path.join(root, "package.json"));
  const lockfile = parseYaml(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"));
  const runtimeManifest = readJson(path.join(root, manifest.runtimeManifest));
  const sourceStats = [];

  if (manifest.schemaVersion !== 1) errors.push(`Unsupported reference schema: ${manifest.schemaVersion}`);
  if (!(manifest.minimumRecallAt5 > 0 && manifest.minimumRecallAt5 <= 1)) {
    errors.push("minimumRecallAt5 must be within (0, 1]");
  }

  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const docIds = new Set(manifest.officialDocs.map((doc) => doc.id));
  const routeIds = new Set(manifest.routes.map((route) => route.id));
  if (sourceIds.size !== manifest.sources.length) errors.push("Duplicate Pi source IDs");
  if (docIds.size !== manifest.officialDocs.length) errors.push("Duplicate official doc IDs");
  if (routeIds.size !== manifest.routes.length) errors.push("Duplicate Pi route IDs");

  for (const source of manifest.sources) {
    const dependencyVersion = packageJson.dependencies?.[source.package] ?? packageJson.devDependencies?.[source.package];
    if (dependencyVersion !== source.version) {
      errors.push(`${source.package}: package.json=${dependencyVersion ?? "missing"}, reference=${source.version}`);
    }
    const runtimeVersion = runtimeVersionFor(source, runtimeManifest);
    if (runtimeVersion !== source.version) {
      errors.push(`${source.package}: runtime manifest=${runtimeVersion ?? "missing"}, reference=${source.version}`);
    }
    if (!/^[0-9a-f]{40}$/.test(source.commit)) errors.push(`${source.package}: invalid source commit`);
    if (!source.integrity.startsWith("sha512-")) errors.push(`${source.package}: invalid integrity`);
    const lockEntry = lockfile.packages?.[`${source.package}@${source.version}`];
    if (lockEntry?.resolution?.integrity !== source.integrity) {
      errors.push(`${source.package}: exact integrity missing from pnpm-lock.yaml package entry`);
    }

    const rootPath = packageRoot(source.package);
    if (!fs.existsSync(path.join(rootPath, "package.json"))) {
      errors.push(`${source.package}: package is not installed; run pnpm install`);
      continue;
    }
    const installed = packageManifest(source.package);
    if (installed.version !== source.version) {
      errors.push(`${source.package}: installed=${installed.version}, expected=${source.version}`);
    }
    if (normalizeRepository(installed.repository) !== normalizeRepository(source.repository)) {
      errors.push(
        `${source.package}: repository=${normalizeRepository(installed.repository) || "missing"}, expected=${source.repository}`,
      );
    }
    const missingFiles = source.requiredFiles.filter((file) => !fs.existsSync(path.join(rootPath, file)));
    if (missingFiles.length > 0) errors.push(`${source.package}: missing ${missingFiles.join(", ")}`);
    sourceStats.push({
      id: source.id,
      package: source.package,
      version: source.version,
      commit: source.commit,
      root: fs.realpathSync(rootPath),
      requiredFiles: source.requiredFiles.length,
    });
  }

  for (const doc of manifest.officialDocs) {
    try {
      const url = new URL(doc.url);
      if (url.protocol !== "https:") errors.push(`${doc.id}: official documentation must use HTTPS`);
    } catch {
      errors.push(`${doc.id}: invalid official documentation URL`);
    }
  }

  for (const route of manifest.routes) {
    if (!Array.isArray(route.keywords) || route.keywords.length < 3) {
      errors.push(`${route.id}: at least three routing keywords are required`);
    }
    for (const appPath of route.appPaths) {
      if (!fs.existsSync(path.join(root, appPath))) errors.push(`${route.id}: missing app path ${appPath}`);
    }
    for (const docRef of route.docRefs) {
      if (!docIds.has(docRef)) errors.push(`${route.id}: unknown doc ref ${docRef}`);
    }
    for (const sourceRef of route.sourceRefs) {
      const separator = sourceRef.indexOf(":");
      const sourceId = sourceRef.slice(0, separator);
      const sourcePath = sourceRef.slice(separator + 1);
      const source = manifest.sources.find((candidate) => candidate.id === sourceId);
      if (separator < 1 || !source) {
        errors.push(`${route.id}: invalid source ref ${sourceRef}`);
        continue;
      }
      if (!fs.existsSync(path.join(packageRoot(source.package), sourcePath))) {
        errors.push(`${route.id}: missing source ref ${sourceRef}`);
      }
    }
  }

  const benchmark = readJson(benchmarkPath);
  for (const scenario of benchmark.scenarios) {
    if (!routeIds.has(scenario.expectedRoute)) {
      errors.push(`${scenario.id}: unknown expected route ${scenario.expectedRoute}`);
    }
  }
  if (benchmark.scenarios.length !== 30) {
    warnings.push(`Expected 30 benchmark scenarios, found ${benchmark.scenarios.length}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sources: sourceStats,
    officialDocs: manifest.officialDocs.length,
    routes: manifest.routes.length,
    scenarios: benchmark.scenarios.length,
  };
}

function normalizedText(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function tokens(value) {
  return normalizedText(value).match(/[\p{L}\p{N}_]+/gu) || [];
}

function scoreRoute(route, query) {
  const queryText = normalizedText(query);
  const queryTokens = new Set(tokens(queryText).filter((token) => token.length > 1));
  const corpus = normalizedText(
    [route.id, route.title, ...route.keywords, ...route.appPaths, ...route.sourceRefs].join(" "),
  );
  const corpusTokens = new Set(tokens(corpus));
  let score = 0;

  if (queryText.includes(normalizedText(route.id).replaceAll("-", " "))) score += 10;
  for (const keyword of route.keywords) {
    const normalizedKeyword = normalizedText(keyword);
    if (queryText.includes(normalizedKeyword)) score += 12 + Math.min(normalizedKeyword.length / 10, 4);
  }
  for (const token of queryTokens) {
    if (corpusTokens.has(token)) score += token.length >= 6 ? 2 : 1;
  }
  return score;
}

function queryRoutes(query, limit = 5) {
  return manifest.routes
    .map((route) => ({ route, score: scoreRoute(route, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.route.id.localeCompare(right.route.id))
    .slice(0, limit);
}

function resolveSourceRef(sourceRef) {
  const separator = sourceRef.indexOf(":");
  const source = manifest.sources.find((candidate) => candidate.id === sourceRef.slice(0, separator));
  return source ? path.join(packageRoot(source.package), sourceRef.slice(separator + 1)) : null;
}

function queryOutput(query, limit) {
  const docsById = new Map(manifest.officialDocs.map((doc) => [doc.id, doc.url]));
  return queryRoutes(query, limit).map(({ route, score }) => ({
    id: route.id,
    title: route.title,
    score: Number(score.toFixed(2)),
    appPaths: route.appPaths,
    sourcePaths: route.sourceRefs.map(resolveSourceRef).filter(Boolean),
    officialDocs: route.docRefs.map((id) => docsById.get(id)).filter(Boolean),
  }));
}

function runBenchmark(writeResult = true) {
  const benchmark = readJson(benchmarkPath);
  const results = benchmark.scenarios.map((scenario) => {
    const routes = queryRoutes(scenario.query, 5).map((entry) => entry.route.id);
    return { ...scenario, routes, passed: routes.includes(scenario.expectedRoute) };
  });
  const passed = results.filter((result) => result.passed).length;
  const recallAt5 = passed / results.length;
  const categories = Object.fromEntries(
    [...new Set(results.map((result) => result.category))].map((category) => {
      const categoryResults = results.filter((result) => result.category === category);
      const categoryPassed = categoryResults.filter((result) => result.passed).length;
      return [category, { passed: categoryPassed, total: categoryResults.length }];
    }),
  );
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    headSha: gitHead(),
    passed,
    total: results.length,
    recallAt5,
    minimumRecallAt5: manifest.minimumRecallAt5,
    ok: recallAt5 >= manifest.minimumRecallAt5,
    categories,
    failures: results.filter((result) => !result.passed),
  };
  if (writeResult) {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "latest-pi-benchmark.json"), `${JSON.stringify(output, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  return output;
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function walkFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(fs.realpathSync(directory));
  return files;
}

function sourceVolume() {
  return manifest.sources.map((source) => {
    const files = walkFiles(packageRoot(source.package));
    const codeFiles = files.filter((file) => /\.(?:[cm]?js|tsx?)$/.test(file));
    const markdownFiles = files.filter((file) => /\.md$/i.test(file));
    let codeLines = 0;
    for (const file of codeFiles) codeLines += fs.readFileSync(file, "utf8").split(/\r?\n/).length;
    return {
      id: source.id,
      version: source.version,
      sourceAndDocFiles: new Set([...codeFiles, ...markdownFiles]).size,
      codeLines,
      markdownFiles: markdownFiles.length,
    };
  });
}

function syncReference() {
  const check = validate();
  if (!check.ok) return { ok: false, check };
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    headSha: gitHead(),
    policy: "read-only local package sources; no runtime or first-use network dependency",
    sources: check.sources,
    officialDocs: manifest.officialDocs,
    routes: manifest.routes.map((route) => ({
      id: route.id,
      title: route.title,
      appPaths: route.appPaths,
      sourcePaths: route.sourceRefs.map(resolveSourceRef).filter(Boolean),
      officialDocs: route.docRefs,
    })),
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "pi-reference-index.json"), `${JSON.stringify(output, null, 2)}\n`, {
    mode: 0o600,
  });
  return { ok: true, outputPath: path.join(stateDir, "pi-reference-index.json"), sources: output.sources.length };
}

async function verifyUpstream() {
  const check = validate();
  if (!check.ok) return { ok: false, localCheck: check, sources: [] };
  const baseUrl = String(process.env.PI_REFERENCE_REGISTRY_BASE_URL || "https://registry.npmjs.org")
    .replace(/\/+$/, "");
  const timeoutMs = Number(process.env.PI_REFERENCE_NETWORK_TIMEOUT_MS || 10_000);
  const sources = [];
  for (const source of manifest.sources) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl}/${encodeURIComponent(source.package)}/${encodeURIComponent(source.version)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "harnss-pi-reference-verifier" },
      });
      if (!response.ok) {
        sources.push({ id: source.id, ok: false, code: `registry_http_${response.status}` });
        continue;
      }
      const metadata = await response.json();
      const checks = {
        version: metadata.version === source.version,
        repository: normalizeRepository(metadata.repository) === normalizeRepository(source.repository),
        commit: metadata.gitHead === source.commit,
        integrity: metadata.dist?.integrity === source.integrity,
      };
      sources.push({ id: source.id, ok: Object.values(checks).every(Boolean), checks });
    } catch (error) {
      sources.push({
        id: source.id,
        ok: false,
        code: error instanceof Error && error.name === "AbortError" ? "registry_timeout" : "registry_unreachable",
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ok: sources.length === manifest.sources.length && sources.every((source) => source.ok),
    registry: baseUrl,
    sources,
  };
}

function usage() {
  console.log(`Usage:
  node scripts/agent-workflow/pi-reference.mjs check [--json]
  node scripts/agent-workflow/pi-reference.mjs sync [--json]
  node scripts/agent-workflow/pi-reference.mjs verify-upstream [--json]
  node scripts/agent-workflow/pi-reference.mjs query <question> [--limit N] [--json]
  node scripts/agent-workflow/pi-reference.mjs benchmark [--json]
  node scripts/agent-workflow/pi-reference.mjs stats [--json]

The reference layer reads the exact Pi packages installed by pnpm. It never
downloads runtime code and does not mix the 100k+ upstream source lines into
the Harnss application graph.`);
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "--") cliArgs.shift();
const [command, ...rawArgs] = cliArgs;
const json = rawArgs.includes("--json");
const args = rawArgs.filter((arg) => arg !== "--json");

try {
  switch (command) {
    case "check": {
      const result = validate();
      print(result, json);
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "sync": {
      const result = syncReference();
      print(result, json);
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "verify-upstream": {
      const result = await verifyUpstream();
      print(result, json);
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "query": {
      const limitIndex = args.indexOf("--limit");
      const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 5;
      const queryArgs = limitIndex >= 0 ? args.filter((_, index) => index !== limitIndex && index !== limitIndex + 1) : args;
      const query = queryArgs.join(" ").trim();
      if (!query || !Number.isInteger(limit) || limit < 1 || limit > 20) {
        usage();
        process.exitCode = 1;
        break;
      }
      const check = validate();
      if (!check.ok) {
        print(check, json);
        process.exitCode = 1;
        break;
      }
      const results = queryOutput(query, limit);
      print({ query, results }, json);
      if (results.length === 0) process.exitCode = 2;
      break;
    }
    case "benchmark": {
      const check = validate();
      if (!check.ok) {
        print(check, json);
        process.exitCode = 1;
        break;
      }
      const result = runBenchmark();
      print(result, json);
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "stats": {
      const check = validate();
      if (!check.ok) {
        print(check, json);
        process.exitCode = 1;
        break;
      }
      const sources = sourceVolume();
      print(
        {
          sources,
          totals: sources.reduce(
            (total, source) => ({
              sourceAndDocFiles: total.sourceAndDocFiles + source.sourceAndDocFiles,
              codeLines: total.codeLines + source.codeLines,
              markdownFiles: total.markdownFiles + source.markdownFiles,
            }),
            { sourceAndDocFiles: 0, codeLines: 0, markdownFiles: 0 },
          ),
        },
        json,
      );
      break;
    }
    case "--help":
    case "-h":
      usage();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
