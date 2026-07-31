# Plugin Center v0.1

Status: Approved for implementation

## Goal

Add a first-class Plugin Center to the fixed sidebar. Selecting Plugins or ACP
Agents keeps the sidebar visible and renders the selected workspace directly in
the main content area. Plugin management must not route through Settings.

The first release covers:

- Skills discovery, installation, update detection, and removal.
- MCP discovery and project-scoped installation.
- The existing ACP Agent registry as a fixed entry below Plugins.

## Source Policy

Each plugin kind has exactly one canonical catalog source in v0.1.

### Skills

- Catalog: `skills.sh`.
- Default browse source: the anonymous public leaderboard at
  `https://skills.sh/trending`, parsed from its rendered HTML in the main
  process and guarded by the same size, timeout, HTTPS, and stale-cache rules
  as JSON catalog requests.
- Search endpoint: the anonymous legacy `https://skills.sh/api/search` endpoint.
- The documented skills.sh v1 JSON API requires Vercel OIDC. A future
  provider-compatible DPCC proxy may expose that contract, but the desktop app
  must not bundle or request a provider credential.
- Artifact source: the public GitHub repository named by the catalog item.
- Default page size: 30 entries for Trending and search.
- The skills.sh catalog does not publish artwork for each entry in its browse
  markup, so the UI derives a publisher avatar from the GitHub owner.
- Installation behavior follows the open-source `vercel-labs/skills` resolver,
  but the desktop app must not execute an unpinned `npx skills@latest`.

The catalog ID, source URL, skill name, and content hash are preserved without
silent rewriting.

### MCP

- Catalog: Official MCP Registry.
- API: a pinned version of the Registry REST/OpenAPI contract.
- Metadata: the published `server.json`.
- Artifact source: the remote URL or npm package declared by `server.json`.
- Default page size: 50 entries for browse and search.

### Catalog Artwork

- Skills use the GitHub publisher avatar derived from the canonical
  `owner/repository` source.
- MCP prefers the upstream `server.json` `icons` entry when it is an HTTPS
  raster image hosted by GitHub or a domain related to the server website,
  repository, or remote endpoint.
- SVG and unrelated third-party icon hosts are rejected. MCP falls back to the
  GitHub repository owner avatar, then both catalogs fall back to a
  deterministic colored monogram.
- Remote images use lazy loading and omit the referrer.

Smithery, Glama, GitHub search, and other marketplaces are not merged into the
v0.1 result set. They may be added later as explicit providers.

## User Experience

The fixed sidebar order is:

1. New chat
2. Search
3. Plugins
4. ACP Agents

Plugins opens the main workspace with two tabs:

- Skills
- MCP

Each tab supports Discover and Installed views. Search and catalog browsing do
not require a selected project. MCP installation requires an active project.
Skills opens with the current skills.sh Trending leaderboard. A trimmed query
of two or more characters replaces that list with search results; shorter
queries keep the Trending view.

Runtime loading follows the navigation boundary:

- The Plugin Center renderer bundle is loaded only after Plugins is opened.
- Skills ships with that bundle because it is the default tab.
- The MCP renderer bundle is loaded only when the MCP tab is selected.
- Inactive tabs remain unmounted and do not start catalog requests.

Skill installation asks for:

- Scope: current project or global.
- Targets: Claude Code, Codex, or both.

MCP installation asks for:

- Current project.
- Remote or npm transport when multiple choices exist.
- Required URL variables, headers, arguments, and environment values.

## Renderer/Main Boundary

Renderer components never fetch catalogs or write plugin files directly.
Preload exposes a typed `plugins` API backed by main-process IPC handlers.

Required operations:

- `plugins:skills:search`
- `plugins:skills:list-installed`
- `plugins:skills:install`
- `plugins:skills:remove`
- `plugins:mcp:list`
- `plugins:mcp:install`

Catalog responses use normalized shared types while preserving the raw upstream
identifier and version.

## Skill Installation

Installed skill files are written to native target locations:

| Target | Project | Global |
| --- | --- | --- |
| Claude Code | `.claude/skills` | `~/.claude/skills` |
| Codex | `.agents/skills` | `~/.agents/skills` |

The installer must:

- Require a valid `SKILL.md`.
- Reject absolute paths, traversal, symlinks that escape the skill root, and
  unsupported special files.
- Enforce file-count and extracted-size limits.
- Stage files in a temporary directory and rename atomically.
- Record every managed path in an installation manifest.
- Remove only paths owned by that manifest.
- Never execute bundled Skill scripts during installation.

Updates compare the installed manifest source revision or hash with the current
catalog/source revision. User-modified managed files require confirmation before
replacement.

## MCP Installation

v0.1 supports:

- Remote `streamable-http`.
- Legacy remote `sse`.
- npm packages using `stdio`.

Other package types remain visible but disabled with an unsupported label.

Registry metadata maps to the existing `McpServerConfig` model:

- `streamable-http` becomes `http`.
- `sse` remains `sse`.
- npm `stdio` becomes `npx -y <identifier>@<version>`.

Secrets must not be written into ordinary catalog cache data. Secret persistence
is isolated from non-secret MCP configuration before marketplace credentials are
enabled.

Claude and ACP sessions may be reloaded through existing paths. Codex MCP
activation remains unavailable until its session configuration path is
implemented and must not be presented as active.

## Cache And Failure

- Catalog networking runs in the main process.
- Successful responses are cached with source and fetch timestamps.
- Cache entries younger than five minutes are returned immediately as fresh.
- Concurrent requests for the same normalized query share one upstream request.
- Entries older than five minutes trigger a refresh instead of blocking catalog
  navigation on permanently cached data.
- A failed refresh may show stale data with a visible stale state.
- The app never silently switches to another marketplace.
- Upstream IDs and source URLs remain inspectable.

## Security

- Treat Skill instructions and MCP commands as executable supply-chain input.
- Display publisher/source, install command or remote URL, and audit status
  before installation.
- Validate all catalog payloads before mapping them to local configuration.
- Apply request timeouts, response-size limits, pagination limits, and HTTPS
  requirements.
- A catalog entry is discoverable, not trusted, merely because it is listed.

## Acceptance Criteria

- Plugins and ACP Agents open in the main workspace without Settings navigation.
- Sidebar active state is mutually exclusive with sessions and Jira.
- Skills loads the configured provider's Trending directory on entry, and
  Skill search works once the trimmed query reaches two characters.
- A managed Skill can be installed and removed from project/global Claude and
  Codex locations without touching unmanaged files.
- MCP entries load from the Official Registry and supported entries can be added
  to the current project through the existing MCP store.
- Unsupported transports are visible but cannot be installed.
- Catalog errors, empty states, stale cache, loading, and installation progress
  have explicit UI states.
- Focused unit tests, typecheck, build, workflow review, and static scan pass.
