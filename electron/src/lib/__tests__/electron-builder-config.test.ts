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
