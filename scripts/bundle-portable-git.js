// Bundle Git for Windows PortableGit for Windows builds.
//
// The Windows artifact is a self-extracting 7z archive. We intentionally do
// not execute or extract it at build time so cross-building Windows x64 from a
// macOS arm64 host works. Runtime extraction happens lazily on Windows only.

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "build", "portable-git");

const ASSETS = {
  "win32-x64": {
    target: "win32-x64",
    fileName: "PortableGit-2.55.0.2-64-bit.7z.exe",
    url: "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.2/PortableGit-2.55.0.2-64-bit.7z.exe",
    size: 59_005_448,
    sha256: "b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df",
  },
};

function parseArgs(argv = process.argv) {
  const platformIndex = argv.indexOf("--platform");
  const archIndex = argv.indexOf("--arch");
  return {
    platform: platformIndex === -1 ? process.platform : argv[platformIndex + 1],
    arch: archIndex === -1 ? os.arch() : argv[archIndex + 1],
  };
}

function resolvePortableGitAsset(platform, arch) {
  const key = `${platform}-${arch}`;
  const asset = ASSETS[key];
  if (!asset) {
    throw new Error(`Unsupported PortableGit target: ${key}`);
  }
  return asset;
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function downloadFile(url, destinationFile) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "PccAgent" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destinationFile).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`PortableGit download failed with HTTP ${response.statusCode || "unknown"}`));
        return;
      }
      const out = fs.createWriteStream(destinationFile, { flags: "w" });
      out.on("error", reject);
      out.on("finish", () => out.close((err) => (err ? reject(err) : resolve())));
      response.on("error", reject);
      response.pipe(out);
    });
    request.on("error", reject);
  });
}

async function bundlePortableGit(platform, arch) {
  const asset = resolvePortableGitAsset(platform, arch);
  const targetDir = path.join(OUTPUT_DIR, asset.target);
  const finalPath = path.join(targetDir, asset.fileName);

  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size === asset.size && hashFile(finalPath) === asset.sha256) {
    console.log(`  • ${asset.target}: already bundled, skipping`);
    return finalPath;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const tmpFile = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    console.log(`  • ${asset.target}: downloading ${asset.fileName}`);
    await downloadFile(asset.url, tmpFile);
    const actualSize = fs.statSync(tmpFile).size;
    if (actualSize !== asset.size) {
      throw new Error(`PortableGit size mismatch: expected ${asset.size}, got ${actualSize}`);
    }
    const actualSha = hashFile(tmpFile);
    if (actualSha !== asset.sha256) {
      throw new Error("PortableGit checksum mismatch");
    }
    fs.renameSync(tmpFile, finalPath);
    console.log(`  • ${asset.target}: bundled ${asset.fileName} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
    return finalPath;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

async function main() {
  const { platform, arch } = parseArgs();
  if (platform !== "win32") {
    console.log(`PortableGit is Windows-only; skipping target ${platform}-${arch}`);
    return;
  }
  await bundlePortableGit(platform, arch);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  bundlePortableGit,
  parseArgs,
  resolvePortableGitAsset,
  __test: {
    resolvePortableGitAsset,
  },
};
