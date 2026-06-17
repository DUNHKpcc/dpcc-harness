// Waits until the Vite dev server responds on the given URL, then exits.
// Falls back to a fixed sleep if the argument is a plain number (legacy usage).
const arg = process.argv[2] ?? "http://localhost:5173/";

if (/^\d+(\.\d+)?$/.test(arg)) {
  setTimeout(() => {}, Number(arg) * 1000);
} else {
  const url = arg;
  const timeoutMs = 60_000;
  const intervalMs = 250;
  const start = Date.now();

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

  (async () => {
    while (Date.now() - start < timeoutMs) {
      if (await ping()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    console.error(`[delay] timed out waiting for ${url}`);
    process.exit(1);
  })();
}
