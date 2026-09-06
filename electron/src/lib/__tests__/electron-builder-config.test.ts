import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const repoRoot = path.resolve(__dirname, "../../../..");
const windowsTargetSizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readIcoSizes(filePath: string): number[] {
  const buffer = fs.readFileSync(filePath);
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const encodedSize = buffer.readUInt8(6 + index * 16);
    return encodedSize === 0 ? 256 : encodedSize;
  });
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

function makeNativeModulesRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
  tempDirs.push(root);

  const nodePtyDir = path.join(root, "node_modules", "node-pty");
  for (const relativePath of [
    "build/obj/compile.tlog",
    "deps/source.cc",
    "scripts/prebuild.js",
    "src/index.ts",
    "third_party/conpty/win10-x64/OpenConsole.exe",
    "typings/node-pty.d.ts",
    "prebuilds/win32-arm64/pty.node",
    "prebuilds/win32-x64/pty.node",
    "prebuilds/win32-x64/pty.pdb",
    "lib/index.js",
    "lib/index.js.map",
    "lib/terminal.test.js",
  ]) {
    const filePath = path.join(nodePtyDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "fixture");
  }

  const onnxDir = path.join(root, "node_modules", "onnxruntime-node", "bin", "napi-v3");
  for (const relativePath of [
    "darwin/arm64/onnxruntime_binding.node",
    "linux/x64/onnxruntime_binding.node",
    "win32/arm64/onnxruntime_binding.node",
    "win32/x64/onnxruntime_binding.node",
  ]) {
    const filePath = path.join(onnxDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "fixture");
  }

  const imgDir = path.join(root, "node_modules", "@img");
  for (const packageName of [
    "colour",
    "sharp-darwin-arm64",
    "sharp-win32-arm64",
    "sharp-win32-x64",
  ]) {
    fs.mkdirSync(path.join(imgDir, packageName), { recursive: true });
  }

  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("electron-builder config", () => {
  it("replaces Claude and Codex runtimes with exact bundled Pi dependencies", () => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../../../../package.json"),
      "utf8",
    )) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    expect(packageJson.dependencies).not.toHaveProperty("@anthropic-ai/claude-agent-sdk");
    expect(packageJson.dependencies).not.toHaveProperty("@anthropic-ai/sdk");
    expect(packageJson.optionalDependencies ?? {}).toEqual({});
    expect(packageJson.scripts).not.toHaveProperty("bundle:codex");
    expect(packageJson.dependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "0.84.1",
      "pi-acp": "0.0.33",
      "pi-mcp-adapter": "2.31.0",
    });
    expect(packageJson.pnpm?.overrides).toMatchObject({
      "@earendil-works/pi-agent-core": "0.84.1",
      "@earendil-works/pi-ai": "0.84.1",
      "@earendil-works/pi-client": "0.84.1",
      "@earendil-works/pi-protocol": "0.84.1",
      "@earendil-works/pi-telemetry": "0.84.1",
      "@earendil-works/pi-tui": "0.84.1",
    });
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

  it("uses the Partner Center identity for Microsoft Store packages", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.default.appx).toMatchObject({
      identityName: "DUNHKpcc.PccAgent",
      publisher: "CN=82449B93-048A-4DA9-A5A1-3970CA02D572",
      publisherDisplayName: "DUNHKpcc",
      applicationId: "PccAgent",
    });
  });

  it("uses the dedicated Windows icon and makes it available to the tray", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.default.win).toMatchObject({
      icon: "build/icon.ico",
      extraResources: [
        {
          from: "build/icon.ico",
          to: "icon.ico",
        },
      ],
    });
    expect(readPngDimensions(path.join(repoRoot, "build", "icon-windows.png"))).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(readIcoSizes(path.join(repoRoot, "build", "icon.ico"))).toEqual(windowsTargetSizes);
  });

  it("copies the renderer logo outside app.asar as a packaged fallback", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.default.extraResources).toContainEqual({
      from: "public/icon.png",
      to: "pcc-agent-logo.png",
    });
    expect(fs.existsSync(path.join(repoRoot, "public", "icon.png"))).toBe(true);
  });

  it("ships the offline Pi launcher and unpacks its native runtime assets", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const runtimeResource = {
      from: "build/pi-runtime",
      to: "pi-runtime",
      filter: ["**/*"],
    };

    expect(config.default.extraResources).toContainEqual(runtimeResource);
    expect(config.default.asarUnpack).toEqual(expect.arrayContaining([
      "node_modules/**/@earendil-works/pi-tui/native/**/*.node",
      "node_modules/**/@mariozechner/clipboard-*/**/*.node",
      "node_modules/**/@napi-rs/keyring-*/**/*.node",
      "node_modules/**/@silvia-odwyer/photon-node/**/*.wasm",
    ]));

    const unixLauncher = path.join(repoRoot, "build", "pi-runtime", "bin", "pi");
    const windowsLauncher = path.join(repoRoot, "build", "pi-runtime", "bin", "pi.cmd");
    const packageBootstrap = path.join(repoRoot, "build", "pi-runtime", "bin", "pcc-pi-package-launch.cjs");
    expect(fs.statSync(unixLauncher).isFile()).toBe(true);
    expect(fs.statSync(unixLauncher).mode & 0o111).not.toBe(0);
    expect(fs.statSync(windowsLauncher).isFile()).toBe(true);
    expect(fs.readFileSync(unixLauncher, "utf8")).not.toMatch(/\b(?:node|npx|pi-acp)\b/);
    expect(fs.readFileSync(windowsLauncher, "utf8")).not.toMatch(/\b(?:node|npx|pi-acp)\b/i);
    expect(fs.readFileSync(unixLauncher, "utf8")).toContain("PCC_AGENT_PI_MCP_EXTENSION");
    expect(fs.readFileSync(unixLauncher, "utf8")).toContain('--extension "$PCC_AGENT_PI_MCP_EXTENSION"');
    expect(fs.readFileSync(unixLauncher, "utf8")).toContain('--skill "$PCC_AGENT_PI_PROJECT_SKILLS"');
    expect(fs.readFileSync(windowsLauncher, "utf8")).toContain('--skill "%PCC_AGENT_PI_PROJECT_SKILLS%"');
    expect(fs.readFileSync(unixLauncher, "utf8")).toContain("PCC_AGENT_PI_PACKAGE_CONFIG");
    expect(fs.readFileSync(windowsLauncher, "utf8")).toContain("PCC_AGENT_PI_PACKAGE_CONFIG");
    expect(fs.statSync(packageBootstrap).isFile()).toBe(true);
    expect(fs.readFileSync(unixLauncher, "utf8")).not.toContain("--approve");
    expect(fs.readFileSync(windowsLauncher, "utf8")).not.toContain("--approve");
    expect(fs.existsSync(path.join(repoRoot, "build", "pi-runtime", "extensions", "pcc-mcp.ts"))).toBe(true);
    expect(config.__test.asarRepackUnpackPattern).toContain("**/*.node");
    expect(config.__test.asarRepackUnpackPattern).toContain("**/*.wasm");
  });

  it("preserves native unpack metadata when afterPack rebuilds app.asar", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const asar = await import("@electron/asar");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-config-test-"));
    tempDirs.push(root);
    const source = path.join(root, "source");
    const archive = path.join(root, "app.asar");
    const nativePath = path.join(source, "node_modules", "fixture", "addon.node");
    const wasmPath = path.join(source, "node_modules", "fixture", "runtime.wasm");
    const jsPath = path.join(source, "node_modules", "fixture", "index.js");
    for (const filePath of [nativePath, wasmPath, jsPath]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "fixture");
    }

    await asar.createPackageWithOptions(source, archive, {
      unpack: config.__test.asarRepackUnpackPattern,
    });

    expect(asar.statFile(archive, "node_modules/fixture/addon.node").unpacked).toBe(true);
    expect(asar.statFile(archive, "node_modules/fixture/runtime.wasm").unpacked).toBe(true);
    expect(asar.statFile(archive, "node_modules/fixture/index.js").unpacked).toBeFalsy();
  });

  it("packages the native menu bar source image on macOS only", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const traySource = {
      from: "build/appx/Square44x44Logo.targetsize-256_altform-lightunplated.png",
      to: "pcc-agent-tray-source.png",
    };

    expect(config.default.mac.extraResources).toContainEqual(traySource);
    expect(config.default.extraResources).not.toContainEqual(traySource);
    expect(config.default.win.extraResources).not.toContainEqual(traySource);
    expect(fs.existsSync(path.join(repoRoot, traySource.from))).toBe(true);
  });

  it("provides unplated AppList icons for every Windows target size and theme", () => {
    const appxDir = path.join(repoRoot, "build", "appx");
    const variants = ["", "_altform-unplated", "_altform-lightunplated"];

    for (const size of windowsTargetSizes) {
      for (const variant of variants) {
        const iconPath = path.join(
          appxDir,
          `Square44x44Logo.targetsize-${size}${variant}.png`,
        );
        expect(fs.existsSync(iconPath), iconPath).toBe(true);
        expect(readPngDimensions(iconPath)).toEqual({ width: size, height: size });
      }
    }
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

  it("keeps only runtime Windows x64 native resources", async () => {
    const config = await import("../../../../electron-builder.config.js");
    const modulesRoot = makeNativeModulesRoot();
    const context = { electronPlatformName: "win32", arch: 1 };

    config.__test.pruneNodePtyForWindowsX64(modulesRoot, context);
    config.__test.pruneOnnxRuntimeForWindowsX64(modulesRoot, context);
    config.__test.pruneSharpForWindowsX64(modulesRoot, context);

    const nodePtyDir = path.join(modulesRoot, "node_modules", "node-pty");
    expect(fs.existsSync(path.join(nodePtyDir, "prebuilds", "win32-x64", "pty.node"))).toBe(true);
    expect(fs.existsSync(path.join(nodePtyDir, "lib", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(nodePtyDir, "prebuilds", "win32-arm64"))).toBe(false);
    expect(fs.existsSync(path.join(nodePtyDir, "build"))).toBe(false);
    expect(fs.existsSync(path.join(nodePtyDir, "third_party"))).toBe(false);
    expect(fs.existsSync(path.join(nodePtyDir, "lib", "index.js.map"))).toBe(false);
    expect(fs.existsSync(path.join(nodePtyDir, "lib", "terminal.test.js"))).toBe(false);

    const onnxDir = path.join(modulesRoot, "node_modules", "onnxruntime-node", "bin", "napi-v3");
    expect(fs.readdirSync(onnxDir)).toEqual(["win32"]);
    expect(fs.readdirSync(path.join(onnxDir, "win32"))).toEqual(["x64"]);

    expect(fs.readdirSync(path.join(modulesRoot, "node_modules", "@img")).sort()).toEqual([
      "colour",
      "sharp-win32-x64",
    ]);
  });

  it("does not package Claude SDK or Codex vendor resources", async () => {
    const config = await import("../../../../electron-builder.config.js");

    expect(config.default.asarUnpack.some((entry: string) => entry.includes("@anthropic-ai"))).toBe(false);
    expect(config.default.extraResources.some((entry: { to?: string }) => entry.to === "codex-vendor")).toBe(false);
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
