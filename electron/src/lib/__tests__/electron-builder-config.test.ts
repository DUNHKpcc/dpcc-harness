import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function makeResourcesDir(...triples: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
  tempDirs.push(root);
  const vendorDir = path.join(root, "codex-vendor");
  for (const triple of triples) {
    fs.mkdirSync(path.join(vendorDir, triple), { recursive: true });
  }
  return root;
}

function makePortableGitResourcesDir(...targets: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
  tempDirs.push(root);
  const portableGitDir = path.join(root, "portable-git");
  for (const target of targets) {
    fs.mkdirSync(path.join(portableGitDir, target), { recursive: true });
  }
  return root;
}

function makeClaudeSdkResourcesDir(...packages: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
  tempDirs.push(root);
  const scopeDir = path.join(root, "app.asar.unpacked", "node_modules", "@anthropic-ai");
  for (const packageName of packages) {
    fs.mkdirSync(path.join(scopeDir, packageName), { recursive: true });
    fs.writeFileSync(path.join(scopeDir, packageName, packageName.includes("win32") ? "claude.exe" : "claude"), "binary");
  }
  return root;
}

function makeClaudeSdkAsarTemp(...packages: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
  tempDirs.push(root);
  const scopeDir = path.join(root, "node_modules", "@anthropic-ai");
  for (const packageName of packages) {
    fs.mkdirSync(path.join(scopeDir, packageName), { recursive: true });
    fs.writeFileSync(path.join(scopeDir, packageName, "package.json"), "{}");
    fs.writeFileSync(path.join(scopeDir, packageName, packageName.includes("win32") ? "claude.exe" : "claude"), "binary");
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("electron-builder config", () => {
  it("declares every latest Claude SDK native package for electron-builder discovery", () => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../../../../package.json"),
      "utf8",
    )) as {
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const sdkVersion = packageJson.dependencies["@anthropic-ai/claude-agent-sdk"].replace(/^\^/, "");
    const expectedPackages = [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-arm64-musl",
      "linux-x64",
      "linux-x64-musl",
      "win32-arm64",
      "win32-x64",
    ].map((target) => `@anthropic-ai/claude-agent-sdk-${target}`);

    expect(packageJson.optionalDependencies).toMatchObject(Object.fromEntries(
      expectedPackages.map((packageName) => [packageName, sdkVersion]),
    ));
  });

  it("does not expose test helpers in production config loads", () => {
    const script = [
      "process.env.NODE_ENV = 'production';",
      "const config = require('./electron-builder.config.js');",
      "console.log(Object.prototype.hasOwnProperty.call(config, '__test') ? 'has-test-helper' : 'clean');",
    ].join("");

    expect(execFileSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, "../../../.."),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", VITEST: "" },
    }).trim()).toBe("clean");
  });

  it("omits PortableGit extraResource when the bundle directory is absent", () => {
    const script = [
      "process.env.NODE_ENV = 'production';",
      "const config = require('./electron-builder.config.js');",
      "console.log(JSON.stringify(config.extraResources));",
    ].join("");

    const raw = execFileSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, "../../../.."),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", VITEST: "" },
    }).trim();

    const extraResources = JSON.parse(raw) as Array<{ to?: string }>;
    expect(extraResources.some((entry) => entry.to === "portable-git")).toBe(false);
  });

  it("maps Windows arm64 builds to a bundled Codex vendor triple", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.__test.codexTripleForBuild("win32", 3)).toBe("aarch64-pc-windows-msvc");
  });

  it("keeps only the Windows x64 Codex vendor triple during win32 x64 packaging", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const resourcesDir = makeResourcesDir(
      "aarch64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "aarch64-pc-windows-msvc",
    );

    config.__test.stripForeignCodexTriples(resourcesDir, {
      electronPlatformName: "win32",
      arch: 1,
    });

    expect(fs.readdirSync(path.join(resourcesDir, "codex-vendor")).sort()).toEqual([
      "x86_64-pc-windows-msvc",
    ]);
  });

  it("keeps only the Windows arm64 Codex vendor triple during win32 arm64 packaging", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const resourcesDir = makeResourcesDir(
      "aarch64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "aarch64-pc-windows-msvc",
    );

    config.__test.stripForeignCodexTriples(resourcesDir, {
      electronPlatformName: "win32",
      arch: 3,
    });

    expect(fs.readdirSync(path.join(resourcesDir, "codex-vendor")).sort()).toEqual([
      "aarch64-pc-windows-msvc",
    ]);
  });

  it("keeps PortableGit only for Windows x64 packaging", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const resourcesDir = makePortableGitResourcesDir("win32-x64", "win32-arm64");

    config.__test.stripForeignPortableGitResources(resourcesDir, {
      electronPlatformName: "win32",
      arch: 1,
    });

    expect(fs.readdirSync(path.join(resourcesDir, "portable-git")).sort()).toEqual([
      "win32-x64",
    ]);
  });

  it("unpacks the latest platform-package Claude SDK binary instead of legacy cli.js", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.default.asarUnpack).toContain("node_modules/@anthropic-ai/claude-agent-sdk-*/claude*");
    expect(config.default.asarUnpack).not.toContain("node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    expect(config.default.asarUnpack).not.toContain("node_modules/@anthropic-ai/claude-agent-sdk/vendor/**");
  });

  it("keeps only the target Claude SDK native package in each packed app", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const resourcesDir = makeClaudeSdkResourcesDir(
      "claude-agent-sdk-darwin-arm64",
      "claude-agent-sdk-darwin-x64",
      "claude-agent-sdk-win32-x64",
    );

    config.__test.stripForeignClaudeSdkPackages(resourcesDir, {
      electronPlatformName: "darwin",
      arch: 3,
    });

    expect(fs.readdirSync(path.join(
      resourcesDir,
      "app.asar.unpacked",
      "node_modules",
      "@anthropic-ai",
    ))).toEqual(["claude-agent-sdk-darwin-arm64"]);
  });

  it("keeps target metadata but excludes native binaries from the repacked asar", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const tempDir = makeClaudeSdkAsarTemp(
      "claude-agent-sdk-darwin-arm64",
      "claude-agent-sdk-darwin-x64",
    );

    config.__test.pruneClaudeSdkPackagesFromAsarTemp(tempDir, {
      electronPlatformName: "darwin",
      arch: 3,
    });

    const targetDir = path.join(
      tempDir,
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk-darwin-arm64",
    );
    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "claude"))).toBe(false);
    expect(fs.existsSync(path.join(
      tempDir,
      "node_modules",
      "@anthropic-ai",
      "claude-agent-sdk-darwin-x64",
    ))).toBe(false);
  });

  it("removes PortableGit from non-Windows packages", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const resourcesDir = makePortableGitResourcesDir("win32-x64");

    config.__test.stripForeignPortableGitResources(resourcesDir, {
      electronPlatformName: "darwin",
      arch: 3,
    });

    expect(fs.existsSync(path.join(resourcesDir, "portable-git"))).toBe(false);
  });

  it("resolves the Windows x64 PortableGit asset for cross-platform bundling", async () => {
    const script = await import("../../../../scripts/bundle-portable-git.js");

    expect(script.__test.resolvePortableGitAsset("win32", "x64")).toMatchObject({
      target: "win32-x64",
      fileName: "PortableGit-2.55.0.2-64-bit.7z.exe",
      size: 59005448,
      sha256: "b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df",
    });
  });

  it("disables native dependency rebuilds for cross-platform Windows packaging", async () => {
    const script = [
      "process.env.NODE_ENV = 'production';",
      "process.argv = ['node', 'electron-builder', '--win', '--x64'];",
      "const config = require('./electron-builder.config.js');",
      "console.log(String(config.npmRebuild));",
    ].join("");

    expect(execFileSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, "../../../.."),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", VITEST: "" },
    }).trim()).toBe("false");
  });
});
