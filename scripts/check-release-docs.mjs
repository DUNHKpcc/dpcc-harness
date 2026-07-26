import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifestPath = path.join(root, "shared/contracts/docs-assets.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

if (manifest.appVersion !== packageJson.version) {
  failures.push(
    `shared/contracts/docs-assets.json appVersion ${manifest.appVersion} does not match package.json ${packageJson.version}`,
  );
}

for (const relativePath of [...manifest.documents, ...manifest.screenshots]) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing release documentation asset: ${relativePath}`);
  }
}

function markdownFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

const files = [
  path.join(root, "README.md"),
  ...markdownFiles(path.join(root, "docs")),
];
const markdownTarget = /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const htmlTarget = /<(?:a|img)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const targets = [
    ...[...content.matchAll(markdownTarget)].map((match) => match[1]),
    ...[...content.matchAll(htmlTarget)].map((match) => match[1]),
  ];
  for (const rawTarget of targets) {
    if (
      rawTarget.startsWith("#")
      || rawTarget.startsWith("/")
      || /^(?:https?:|mailto:|data:)/i.test(rawTarget)
    ) {
      continue;
    }
    const target = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]);
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
      failures.push(`${path.relative(root, file)} links to missing ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(
  `documentation check passed (${files.length} Markdown files, ${manifest.screenshots.length} screenshots)`,
);
