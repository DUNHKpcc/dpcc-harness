const path = require("path");
const fs = require("fs");

// --- afterPack: strip bloat from the asar archive ---
// electron-builder v26 has a bug where the `files` config (negation-only,
// positive whitelist, AND FileSet with filter) is only applied to
// nodeModuleFilePatterns (node_modules filtering), NOT to the app directory
// walker (firstOrDefaultFilePatterns). Even the built-in default exclusions
// (e.g. !**/{.git,...}) don't work — .git ends up in the asar.
//
// Workaround: afterPack runs after the asar is packed. We extract it, keep
// ONLY what the app needs at runtime (whitelist), and repack.
const KEEP_ENTRIES = new Set([
  "package.json",
  "index.html",
  "dist",         // Vite-bundled renderer output
  "electron",     // tsup-compiled main/preload (electron/dist/)
  "node_modules", // production dependencies (already filtered by electron-builder)
]);
const ASAR_REPACK_UNPACK_PATTERN = "{**/node_modules/node-pty/**,**/node_modules/electron-liquid-glass/**,**/*.node,**/*.wasm,**/*.dll,**/*.dylib,**/*.so}";

function portableGitTargetForBuild(platformName, archEnum) {
  const platform = platformName === "mas" ? "darwin" : platformName;
  if (platform !== "win32") return null;
  const arch = archEnum === 1 ? "x64" : null;
  return arch === "x64" ? "win32-x64" : null;
}

function stripForeignPortableGitResources(resourcesDir, context) {
  const portableGitDir = path.join(resourcesDir, "portable-git");
  if (!fs.existsSync(portableGitDir)) return;

  const wantTarget = portableGitTargetForBuild(context.electronPlatformName, context.arch);
  if (!wantTarget) {
    console.log("  • afterPack: stripping PortableGit from non-Windows-x64 package");
    fs.rmSync(portableGitDir, { recursive: true, force: true });
    return;
  }

  for (const entry of fs.readdirSync(portableGitDir)) {
    if (entry !== wantTarget) {
      console.log(`  • afterPack: stripping non-target PortableGit ${entry}`);
      fs.rmSync(path.join(portableGitDir, entry), { recursive: true, force: true });
    }
  }
}

function removeMatchingFiles(rootDir, shouldRemove) {
  if (!fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (shouldRemove(entry.name)) {
        fs.rmSync(fullPath, { force: true });
      }
    }
  }
}

function pruneNodePtyForWindowsX64(modulesRoot, context) {
  if (context.electronPlatformName !== "win32" || context.arch !== 1) return;
  const packageDir = path.join(modulesRoot, "node_modules", "node-pty");
  if (!fs.existsSync(packageDir)) return;

  for (const entry of ["bin", "build", "deps", "scripts", "src", "third_party", "typings"]) {
    fs.rmSync(path.join(packageDir, entry), { recursive: true, force: true });
  }

  const prebuildsDir = path.join(packageDir, "prebuilds");
  if (fs.existsSync(prebuildsDir)) {
    for (const entry of fs.readdirSync(prebuildsDir)) {
      if (entry !== "win32-x64") {
        fs.rmSync(path.join(prebuildsDir, entry), { recursive: true, force: true });
      }
    }
  }

  removeMatchingFiles(packageDir, (name) =>
    name.endsWith(".map") || name.endsWith(".pdb") || name.includes(".test."));
}

function pruneOnnxRuntimeForWindowsX64(modulesRoot, context) {
  if (context.electronPlatformName !== "win32" || context.arch !== 1) return;
  const napiDir = path.join(
    modulesRoot,
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v3",
  );
  if (!fs.existsSync(napiDir)) return;

  for (const platform of fs.readdirSync(napiDir)) {
    const platformDir = path.join(napiDir, platform);
    if (platform !== "win32") {
      fs.rmSync(platformDir, { recursive: true, force: true });
      continue;
    }
    for (const arch of fs.readdirSync(platformDir)) {
      if (arch !== "x64") {
        fs.rmSync(path.join(platformDir, arch), { recursive: true, force: true });
      }
    }
  }
}

function pruneSharpForWindowsX64(modulesRoot, context) {
  if (context.electronPlatformName !== "win32" || context.arch !== 1) return;
  const imgScopeDir = path.join(modulesRoot, "node_modules", "@img");
  if (!fs.existsSync(imgScopeDir)) return;

  for (const entry of fs.readdirSync(imgScopeDir)) {
    if ((entry.startsWith("sharp-") || entry.startsWith("sharp-libvips-")) && entry !== "sharp-win32-x64") {
      fs.rmSync(path.join(imgScopeDir, entry), { recursive: true, force: true });
    }
  }
}

function extraResourcesConfig() {
  const resources = [
    {
      from: "public/icon.png",
      to: "pcc-agent-logo.png",
    },
    {
      from: "build/pi-runtime",
      to: "pi-runtime",
      filter: ["**/*"],
    },
  ];

  if (fs.existsSync(path.join(__dirname, "build", "portable-git"))) {
    resources.push({
      from: "build/portable-git",
      to: "portable-git",
      filter: ["**/*"],
    });
  }

  return resources;
}

async function afterPackHook(context) {
  const resourcesDir = ["darwin", "mas"].includes(context.electronPlatformName)
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");

  stripForeignPortableGitResources(resourcesDir, context);
  const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked");

  const asarPath = path.join(resourcesDir, "app.asar");
  if (!fs.existsSync(asarPath)) {
    pruneNodePtyForWindowsX64(unpackedRoot, context);
    pruneOnnxRuntimeForWindowsX64(unpackedRoot, context);
    pruneSharpForWindowsX64(unpackedRoot, context);
    return;
  }

  // @electron/asar is a transitive dep of electron-builder, always available
  const asar = require("@electron/asar");
  const tmpDir = path.join(resourcesDir, "_asar_tmp");

  console.log("  \u2022 afterPack: extracting asar to strip bloat...");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  asar.extractAll(asarPath, tmpDir);

  // Remove everything not in the whitelist
  const entries = fs.readdirSync(tmpDir);
  for (const entry of entries) {
    if (!KEEP_ENTRIES.has(entry)) {
      fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
    }
  }

  // Inside electron/, keep only dist/ (compiled JS), remove src/ and other dev files
  const electronDir = path.join(tmpDir, "electron");
  if (fs.existsSync(electronDir)) {
    for (const sub of fs.readdirSync(electronDir)) {
      if (sub !== "dist") {
        fs.rmSync(path.join(electronDir, sub), { recursive: true, force: true });
      }
    }
  }

  // ASAR extraction reads entries from app.asar.unpacked. Prune both trees
  // only after extraction so the archive can be reconstructed successfully.
  pruneNodePtyForWindowsX64(unpackedRoot, context);
  pruneOnnxRuntimeForWindowsX64(unpackedRoot, context);
  pruneSharpForWindowsX64(unpackedRoot, context);
  pruneNodePtyForWindowsX64(tmpDir, context);
  pruneOnnxRuntimeForWindowsX64(tmpDir, context);
  pruneSharpForWindowsX64(tmpDir, context);

  console.log("  \u2022 afterPack: repacking asar...");
  fs.rmSync(asarPath, { force: true });
  fs.rmSync(unpackedRoot, { recursive: true, force: true });
  await asar.createPackageWithOptions(tmpDir, asarPath, {
    unpack: ASAR_REPACK_UNPACK_PATTERN,
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Log final size for visibility
  const finalSize = fs.statSync(asarPath).size;
  const mb = (finalSize / 1024 / 1024).toFixed(1);
  console.log(`  \u2022 afterPack: asar cleaned \u2014 ${mb} MB`);
}

function isWindowsBuildTarget(argv = process.argv) {
  return argv.some((arg) => arg === "--win" || arg === "--windows" || arg === "-w");
}

function shouldRebuildNativeDeps(argv = process.argv, hostPlatform = process.platform) {
  return !(hostPlatform !== "win32" && isWindowsBuildTarget(argv));
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.pccagent.app",
  productName: "PccAgent",

  directories: {
    output: "release/${version}",
    buildResources: "build",
  },

  // --- Files to include in the app ---
  // NOTE: Due to electron-builder v26 bug, these patterns only affect
  // nodeModuleFilePatterns (node_modules filtering). App directory exclusions
  // are handled by the afterPack hook above which strips bloat from the asar.
  files: [
    "!**/{test,tests,__tests__,__mocks__,spec,specs}/**",
    "!**/*.d.ts",
    "!**/*.d.cts",
    "!**/*.d.mts",
    "!**/*.map",
  ],

  // --- ASAR packing ---
  asar: true,
  asarUnpack: [
    "node_modules/node-pty/**",
    "node_modules/electron-liquid-glass/**",
    "node_modules/**/@earendil-works/pi-tui/native/**/*.node",
    "node_modules/**/@mariozechner/clipboard-*/**/*.node",
    "node_modules/**/@napi-rs/keyring-*/**/*.node",
    "node_modules/**/@silvia-odwyer/photon-node/**/*.wasm",
  ],

  npmRebuild: shouldRebuildNativeDeps(),
  nodeGypRebuild: false,
  includePdb: false,

  extraResources: extraResourcesConfig(),

  afterPack: afterPackHook,

  // --- macOS ---
  mac: {
    target: ["dmg", "zip"],
    artifactName: "${productName}-${version}-mac-${arch}.${ext}",
    category: "public.app-category.developer-tools",
    // Use the regenerated .icns (824/1024 content grid, ~10% margin) instead of
    // the full-bleed .icon, which rendered oversized in the Dock. Revert to
    // "build/icon.icon" once it's rebuilt in Icon Composer with proper insets.
    icon: "build/icon.icns",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extraResources: [
      {
        from: "build/appx/Square44x44Logo.targetsize-256_altform-lightunplated.png",
        to: "pcc-agent-tray-source.png",
      },
    ],
    extendInfo: {
      NSMicrophoneUsageDescription: "PccAgent uses the microphone for voice dictation to transcribe speech into text.",
    },
  },

  dmg: {
    artifactName: "${productName}-${version}-mac-${arch}.${ext}",
    icon: "build/icon.icns",
    background: "build/background.png",
    contents: [
      { x: 160, y: 245 },
      { x: 440, y: 245, type: "link", path: "/Applications" },
    ],
    window: { width: 600, height: 400 },
  },

  // --- Windows ---
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
    extraResources: [
      {
        from: "build/icon.ico",
        to: "icon.ico",
      },
    ],
    files: [
      "!node_modules/electron-liquid-glass/**",
      "!node_modules/node-pty/prebuilds/darwin-*/**",
      "!node_modules/node-pty/prebuilds/linux-*/**",
    ],
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    // Include platform + arch so users do not mistake x64 builds for universal builds.
    artifactName: "${productName}-${version}-windows-${arch}-setup.${ext}",
  },

  // Microsoft Store package identity. These values are assigned by Partner
  // Center and must match the product identity exactly.
  appx: {
    identityName: "DUNHKpcc.PccAgent",
    publisher: "CN=82449B93-048A-4DA9-A5A1-3970CA02D572",
    publisherDisplayName: "DUNHKpcc",
    applicationId: "PccAgent",
    displayName: "PccAgent",
    languages: ["en-US", "zh-CN"],
    backgroundColor: "#000000",
    artifactName: "${productName}-${version}-windows-${arch}-store.${ext}",
  },

  // --- Linux ---
  linux: {
    target: [
      { target: "AppImage" },
      { target: "deb" },
    ],
    category: "Development",
    icon: "build/icon.png",
    files: [
      "!node_modules/electron-liquid-glass/**",
      "!node_modules/node-pty/prebuilds/darwin-*/**",
      "!node_modules/node-pty/prebuilds/win32-*/**",
    ],
  },

  deb: {
    depends: ["libnotify4", "libsecret-1-0"],
  },

  // --- Auto-update ---
  publish: {
    provider: "github",
    owner: "DUNHKpcc",
    repo: "dpcc-harness",
    releaseType: "release",
  },

  afterSign: "scripts/notarize.js",
};

if (process.env.NODE_ENV === "test" || process.env.VITEST) {
  Object.defineProperty(module.exports, "__test", {
    value: {
      portableGitTargetForBuild,
      stripForeignPortableGitResources,
      pruneNodePtyForWindowsX64,
      pruneOnnxRuntimeForWindowsX64,
      pruneSharpForWindowsX64,
      extraResourcesConfig,
      shouldRebuildNativeDeps,
      asarRepackUnpackPattern: ASAR_REPACK_UNPACK_PATTERN,
    },
  });
}
