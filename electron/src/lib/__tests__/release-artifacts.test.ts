import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");
const requireFromTest = createRequire(import.meta.url);

describe("release artifact configuration", () => {
  it("uses explicit platform and architecture names for downloadable installers", () => {
    const config = requireFromTest(path.join(repoRoot, "electron-builder.config.js"));

    expect(config.mac.artifactName).toBe("${productName}-${version}-mac-${arch}.${ext}");
    expect(config.dmg.artifactName).toBe("${productName}-${version}-mac-${arch}.${ext}");
    expect(config.nsis.artifactName).toBe("${productName}-${version}-windows-${arch}-setup.${ext}");
  });

  it("publishes only selected release assets from CI", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/build.yml"), "utf8");

    expect(workflow).not.toContain("--publish ${{ startsWith(github.ref, 'refs/tags/v') && 'always' || 'never' }}");
    expect(workflow).toContain("--publish never");
    expect(workflow).toContain('for file in "${DIR}"/*.dmg "${DIR}"/*.zip "${DIR}"/latest-mac.yml; do');
    expect(workflow).toContain('for file in "${DIR}"/*.exe "${DIR}"/latest.yml; do');
  });

  it("creates the GitHub release before upload jobs run", () => {
    const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/build.yml"), "utf8");

    expect(workflow).toContain("ensure-release:");
    expect(workflow).toContain('gh release create "$TAG"');
    expect(workflow).toContain("needs: [prepare-release, test, ensure-release]");
  });
});
