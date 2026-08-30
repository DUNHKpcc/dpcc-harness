# Bundled Pi Runtime

PccAgent includes the following runtime packages so the built-in Pi Agent can
start without downloading software on the user's machine:

- `@earendil-works/pi-coding-agent` 0.84.1, MIT license
- `pi-acp` 0.0.33, MIT license
- `pi-mcp-adapter` 2.31.0, MIT license

Their npm package contents and production dependencies are installed from the
repository lockfile and shipped inside the signed PccAgent application. The
launcher files in this directory use PccAgent's Electron executable as the
Node runtime; they do not invoke a system `node`, `pi`, `pi-acp`, or `npx`.
