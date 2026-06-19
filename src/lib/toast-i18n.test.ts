import fs from "fs";
import path from "path";
import i18n from "@/i18n";
import { describe, expect, it } from "vitest";
import { toastText } from "./toast-i18n";

const repoRoot = path.resolve(__dirname, "../..");
const toastLiteralPattern = /toast(?:\.(?:error|warning|success|info|message))?\(\s*["`]/;

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("toast i18n", () => {
  it("reads toast text from the active language", async () => {
    await i18n.changeLanguage("zh");
    expect(toastText("permission.respondFailed")).toBe("响应权限请求失败");
  });

  it("keeps toast titles out of inline string literals", () => {
    const offenders = collectSourceFiles(path.join(repoRoot, "src"))
      .filter((filePath) => toastLiteralPattern.test(fs.readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(repoRoot, filePath));

    expect(offenders).toEqual([]);
  });
});
