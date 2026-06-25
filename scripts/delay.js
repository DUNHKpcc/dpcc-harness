// Waits until the Vite dev server responds on the given URL, then exits.
// Additional arguments are file paths that must exist and have been written
// after this script started. This avoids Electron launching while tsup has
// cleaned electron/dist but has not yet emitted main.js.
// Falls back to a fixed sleep if the argument is a plain number (legacy usage).
const fs = require("fs");
const path = require("path");

const [arg = "http://localhost:5173/", ...requiredFiles] = process.argv.slice(2);
const start = Date.now();

if (/^\d+(\.\d+)?$/.test(arg)) {
  setTimeout(() => {}, Number(arg) * 1000);
} else {
  const url = arg;
  const timeoutMs = 60_000;
  const intervalMs = 250;
  const ping = () =>
    new Promise((resolve) => {
      const req = require(url.startsWith("https:") ? "https" : "http").get(url, (res) => {
        res.resume();
        resolve(res.statusCode != null && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });

  const freshFileExists = (filePath) => {
    try {
      const stat = fs.statSync(path.resolve(filePath));
      return stat.isFile() && stat.mtimeMs >= start;
    } catch {
      return false;
    }
  };

  (async () => {
    while (Date.now() - start < timeoutMs) {
      if ((await ping()) && requiredFiles.every(freshFileExists)) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    const files = requiredFiles.length > 0 ? ` and fresh files: ${requiredFiles.join(", ")}` : "";
    console.error(`[delay] timed out waiting for ${url}${files}`);
    process.exit(1);
  })();
}
