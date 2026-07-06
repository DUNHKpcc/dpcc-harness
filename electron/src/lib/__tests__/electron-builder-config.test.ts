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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("electron-builder config", () => {
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
