# Bundled Pi Runtime

PccAgent includes the following runtime packages so the built-in Pi Agent can
start without downloading software on the user's machine:

- `@earendil-works/pi-coding-agent` 0.84.1, MIT license
- `pi-acp` 0.0.33, MIT license
- `pi-mcp-adapter` 2.31.0, MIT license

The bundled `pcc-context-usage.ts` extension is an Harnss-owned, read-only
adapter informed by `pi-context-usage` 1.0.2 from
`championswimmer/pi-context-usage` (commit
`aa1a0150c2d5420f7c64c5e177630baab70e927a`). Its package metadata declares
the ISC license. PccAgent does not ship its terminal UI, release command, or
runtime dependency tree.

Their npm package contents and production dependencies are installed from the
repository lockfile and shipped inside the signed PccAgent application. The
launcher files in this directory use PccAgent's Electron executable as the
Node runtime; they do not invoke a system `node`, `pi`, `pi-acp`, or `npx`.
