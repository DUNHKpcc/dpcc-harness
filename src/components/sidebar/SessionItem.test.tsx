import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

describe("SessionItem rename input", () => {
  it("keeps its focus ring inside the nested sidebar container", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "src/components/sidebar/SessionItem.tsx"),
      "utf8",
    );

    expect(source).toContain("py-px ps-2");
    expect(source).toContain("h-7 min-w-0 flex-1");
    expect(source).toContain("ring-1 ring-inset ring-sidebar-ring");
  });
});
