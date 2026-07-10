import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function makeVendorDir(...triples: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-vendor-test-"));
  tempDirs.push(root);
  for (const triple of triples) {
    fs.mkdirSync(path.join(root, triple, "bin"), { recursive: true });
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bundle-codex script", () => {
  it("maps Windows Codex download targets", async () => {
    const { codexTagForTriple } = await import("../../../../scripts/bundle-codex.js");

    expect(codexTagForTriple("x86_64-pc-windows-msvc")).toBe("win32-x64");
    expect(codexTagForTriple("aarch64-pc-windows-msvc")).toBe("win32-arm64");
  });

  it("refreshes requested vendor triples instead of retaining a stale SDK bundle", () => {
    const script = fs.readFileSync(path.resolve(__dirname, "../../../../scripts/bundle-codex.js"), "utf8");

    expect(script).not.toContain("already bundled, skipping");
  });

  it("removes stale vendor triples that were not requested for this build", async () => {
    const { pruneForeignTriples } = await import("../../../../scripts/bundle-codex.js");
    const outputDir = makeVendorDir(
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "x86_64-pc-windows-msvc",
      "aarch64-pc-windows-msvc",
    );

    pruneForeignTriples(outputDir, ["aarch64-apple-darwin", "x86_64-pc-windows-msvc"]);

    expect(fs.existsSync(path.join(outputDir, "aarch64-apple-darwin"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "x86_64-pc-windows-msvc"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "x86_64-apple-darwin"))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, "aarch64-pc-windows-msvc"))).toBe(false);
  });
});
