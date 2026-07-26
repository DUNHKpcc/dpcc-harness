import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mapPath = path.join(root, "shared/contracts/code-review-map.json");
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const failures = [];

for (const relationship of map.relationships ?? []) {
  if (!relationship.contract || relationship.sources?.length === 0 || relationship.tests?.length === 0) {
    failures.push("every test relationship must name a contract, source files, and test files");
    continue;
  }
  for (const relativePath of [...relationship.sources, ...relationship.tests]) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      failures.push(`${relationship.contract} references missing ${relativePath}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`test map check passed (${map.relationships.length} contract relationships)`);
