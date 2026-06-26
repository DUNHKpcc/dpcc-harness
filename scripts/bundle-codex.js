// Bundle the Codex native binary into the build so the packaged app ships
// with Codex offline — no npm download required at first run.
//
// Downloads `@openai/codex@<platform-tag>` for one or more target triples via
// `npm pack`, extracts each package, and lays the full vendor directory out
// under `build/codex-vendor/<triple>/`. electron-builder then copies this dir
// into the app as `extraResources` (see electron-builder.config.js), and the
// afterPack hook strips the triples that don't match the arch being packed.
//
// The Codex binary needs its sibling resources to work — `codex-path/rg`
// (ripgrep), `codex-resources/` (zsh on macOS), and `codex-package.json`
// (layout metadata). We preserve the whole `vendor/<triple>/` layout so the
// binary resolves them relative to itself.
//
// Usage:
//   node scripts/bundle-codex.js                       # current platform+arch
//   node scripts/bundle-codex.js --triples <a>,<b>     # explicit triples
//   TARGET_TRIPLES=<a>,<b> node scripts/bundle-codex.js
//
// Each run prunes stale output triples that were not requested. This keeps
// build/codex-vendor aligned with the current packaging target and avoids
// copying old platform binaries into electron-builder's staging area.
//
// Triples: aarch64-apple-darwin, x86_64-apple-darwin,
//          x86_64-pc-windows-msvc,
//          x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUTPUT_DIR = path.join(__dirname, "..", "build", "codex-vendor");

// Map a vendor target triple → the @openai/codex npm dist-tag (platform-arch).
const TRIPLE_TO_TAG = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "win32-x64",
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
};

function currentTriple() {
  const key = `${process.platform}-${os.arch()}`;
  const map = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
  };
  const triple = map[key];
  if (!triple) throw new Error(`Unsupported platform/arch for Codex bundling: ${key}`);
  return triple;
}

function resolveTriples() {
  const argIdx = process.argv.indexOf("--triples");
  const raw =
    (argIdx !== -1 ? process.argv[argIdx + 1] : undefined) ||
    process.env.TARGET_TRIPLES ||
    "";
  const triples = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return triples.length > 0 ? triples : [currentTriple()];
}

function pruneForeignTriples(outputDir, requestedTriples) {
  if (!fs.existsSync(outputDir)) return;

  const keep = new Set(requestedTriples);
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    console.log(`  • ${entry.name}: removing stale bundled triple`);
    fs.rmSync(path.join(outputDir, entry.name), { recursive: true, force: true });
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function bundleTriple(triple) {
  const tag = codexTagForTriple(triple);
  if (!tag) throw new Error(`Unknown Codex target triple: ${triple}`);

  const destDir = path.join(OUTPUT_DIR, triple);
  if (fs.existsSync(path.join(destDir, "bin"))) {
    console.log(`  • ${triple}: already bundled, skipping`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `codex-bundle-${tag}-`));
  try {
    const spec = `@openai/codex@${tag}`;
    console.log(`  • ${triple}: npm pack ${spec}`);
    execFileSync(npmCommand(), ["pack", spec, "--pack-destination", "."], {
      cwd: tmpDir,
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 300_000,
      // Node 22 refuses to spawn `npm.cmd` (a .bat/.cmd) without a shell — it
      // throws EINVAL. Use a shell on Windows; npm is a real binary elsewhere.
      shell: process.platform === "win32",
    });

    const tgz = fs.readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error(`npm pack produced no .tgz for ${spec}`);

    execFileSync("tar", ["xzf", tgz], { cwd: tmpDir, timeout: 120_000 });

    // Each platform-specific @openai/codex package ships exactly one vendor
    // triple dir. It usually matches our target triple, but upstream may name
    // it differently (e.g. linux now ships `x86_64-unknown-linux-musl`, not the
    // `-gnu` triple we request). Prefer an exact match, else fall back to the
    // sole vendor subdir. The binary resolves its siblings relative to itself,
    // so copying that dir's contents under our triple name still works.
    const vendorRoot = path.join(tmpDir, "package", "vendor");
    let vendorSrc = path.join(vendorRoot, triple);
    if (!fs.existsSync(vendorSrc)) {
      const subdirs = fs.existsSync(vendorRoot)
        ? fs
            .readdirSync(vendorRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
        : [];
      if (subdirs.length === 1) {
        vendorSrc = path.join(vendorRoot, subdirs[0]);
        console.log(`  • ${triple}: using vendor dir "${subdirs[0]}"`);
      } else {
        throw new Error(
          `Expected vendor layout not found at ${vendorSrc} (vendor/ contains: ${subdirs.join(", ") || "nothing"})`,
        );
      }
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(vendorSrc, destDir, { recursive: true });

    // Ensure the entrypoint + bundled tools are executable (tar usually preserves
    // mode, but normalize to be safe on all extractors).
    const binName = triple.includes("windows") ? "codex.exe" : "codex";
    const entry = path.join(destDir, "bin", binName);
    if (fs.existsSync(entry)) fs.chmodSync(entry, 0o755);
    const rgName = triple.includes("windows") ? "rg.exe" : "rg";
    const rg = path.join(destDir, "codex-path", rgName);
    if (fs.existsSync(rg)) fs.chmodSync(rg, 0o755);

    const size = dirSizeMb(destDir);
    console.log(`  • ${triple}: bundled (${size} MB)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function dirSizeMb(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  }
  return (total / 1024 / 1024).toFixed(1);
}

function codexTagForTriple(triple) {
  return TRIPLE_TO_TAG[triple];
}

function main() {
  const triples = resolveTriples();
  console.log(`Bundling Codex for: ${triples.join(", ")}`);
  pruneForeignTriples(OUTPUT_DIR, triples);
  for (const triple of triples) {
    bundleTriple(triple);
  }
  console.log(`Done. Output: ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  codexTagForTriple,
  pruneForeignTriples,
};
