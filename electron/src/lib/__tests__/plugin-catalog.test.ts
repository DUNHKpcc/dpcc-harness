import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogStoreMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../json-file-store", () => ({
  JsonFileStore: class {
    load(key: string) {
      return catalogStoreMocks.load(key);
    }

    save(key: string, data: unknown) {
      catalogStoreMocks.save(key, data);
    }
  },
}));

import {
  normalizeMcpRegistryResponse,
  normalizeSkillLeaderboardHtml,
  normalizeSkillSearchResponse,
  resolveMcpCatalogInstall,
  searchMcpCatalog,
  searchSkillCatalog,
} from "../plugin-catalog";

function catalogResponse(url: string, body: string): Response {
  return {
    url,
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(Buffer.byteLength(body)) }),
    body: new Response(body).body,
  } as Response;
}

beforeEach(() => {
  catalogStoreMocks.load.mockReset();
  catalogStoreMocks.load.mockReturnValue(null);
  catalogStoreMocks.save.mockReset();
});

describe("plugin catalog normalization", () => {
  it("keeps skills.sh identifiers and only enables GitHub shorthand sources", () => {
    const items = normalizeSkillSearchResponse({
      skills: [
        { id: "owner/repo/skill", name: "skill", source: "owner/repo", installs: 42 },
        { id: "remote/skill", name: "remote", source: "https://example.com/skill", installs: 2 },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: "owner/repo/skill",
        source: "owner/repo",
        installable: true,
      }),
      expect.objectContaining({
        id: "remote/skill",
        installable: false,
      }),
    ]);
  });

  it("maps the public skills.sh trending leaderboard into catalog items", async () => {
    const items = await normalizeSkillLeaderboardHtml(`
      <main>
        <a href="/design-layers/agent-skills/sleek-design-mobile-apps">
          <span>1</span>
          <h3>sleek-design-mobile-apps</h3>
          <p>design-layers/agent-skills</p>
          <span>22.2K</span>
        </a>
        <a href="https://example.com/not-a-skill">
          <h3>not-a-skill</h3>
          <p>example/not-a-skill</p>
        </a>
        <a href="/101-skills/skills/ai-video-generation">
          <span>2</span>
          <h3>ai-video-generation</h3>
          <p>101-skills/skills</p>
          <span>1,234</span>
        </a>
      </main>
    `);

    expect(items).toEqual([
      {
        id: "design-layers/agent-skills/sleek-design-mobile-apps",
        name: "sleek-design-mobile-apps",
        source: "design-layers/agent-skills",
        installs: 22_200,
        url: "https://skills.sh/design-layers/agent-skills/sleek-design-mobile-apps",
        iconUrl: "https://github.com/design-layers.png?size=80",
        installable: true,
      },
      {
        id: "101-skills/skills/ai-video-generation",
        name: "ai-video-generation",
        source: "101-skills/skills",
        installs: 1_234,
        url: "https://skills.sh/101-skills/skills/ai-video-generation",
        iconUrl: "https://github.com/101-skills.png?size=80",
        installable: true,
      },
    ]);
  });

  it("rejects leaderboard anchors whose path does not match the rendered source", async () => {
    const items = await normalizeSkillLeaderboardHtml(`
      <a href="/owner/repo/forged-skill">
        <h3>real-skill</h3>
        <p>owner/repo</p>
        <span>9K</span>
      </a>
    `);

    expect(items).toEqual([]);
  });

  it("loads the public Trending page when the Skill query is shorter than two characters", async () => {
    const html = `
      <a href="/owner/repo/useful-skill">
        <h3>useful-skill</h3>
        <p>owner/repo</p>
        <span>7.5K</span>
      </a>
    `;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      catalogResponse("https://skills.sh/trending", html),
    );

    const result = await searchSkillCatalog("a");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://skills.sh/trending",
      expect.objectContaining({ headers: { Accept: "text/html" } }),
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "owner/repo/useful-skill",
        installs: 7_500,
      }),
    ]);
  });

  it("switches to the JSON search endpoint for a two-character Skill query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      catalogResponse(
        "https://skills.sh/api/search?q=ui&limit=30",
        JSON.stringify({
          skills: [{ id: "owner/repo/ui", name: "ui", source: "owner/repo", installs: 12 }],
        }),
      ),
    );

    const result = await searchSkillCatalog(" ui ");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://skills.sh/api/search?q=ui&limit=30",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(result.items[0]).toMatchObject({ id: "owner/repo/ui", installs: 12 });
  });

  it("rejects npm packages with runtime arguments while keeping plain stdio packages supported", () => {
    const [item] = normalizeMcpRegistryResponse({
      servers: [{
        server: {
          name: "io.github.example/files",
          title: "Files",
          description: "Read files",
          version: "1.2.3",
          websiteUrl: "https://example.com",
          icons: [{ src: "https://example.com/icon.png", mimeType: "image/png" }],
          repository: { url: "https://github.com/example/files" },
          remotes: [{
            type: "streamable-http",
            url: "https://example.com/{tenant}/mcp",
            variables: {
              tenant: { description: "Tenant", isRequired: true },
            },
          }],
          packages: [
            {
              registryType: "npm",
              identifier: "@example/files",
              version: "1.2.3",
              transport: { type: "stdio" },
              runtimeArguments: [
                { value: "--package", type: "positional" },
                { value: "@attacker/override", type: "positional" },
              ],
              packageArguments: [{
                type: "named",
                name: "--root",
                description: "Root directory",
                isRequired: true,
              }],
              environmentVariables: [{
                name: "READ_ONLY",
                default: "true",
              }],
            },
            {
              registryType: "npm",
              identifier: "@example/plain",
              version: "1.2.3",
              transport: { type: "stdio" },
            },
          ],
        },
      }],
    });

    expect(item).toMatchObject({
      name: "io.github.example/files",
      title: "Files",
      version: "1.2.3",
      iconUrl: "https://example.com/icon.png",
      repositoryUrl: "https://github.com/example/files",
    });
    expect(item.installOptions).toEqual([
      expect.objectContaining({
        kind: "remote",
        transport: "http",
        supported: true,
      }),
      expect.objectContaining({
        kind: "npm",
        transport: "stdio",
        supported: false,
        packageName: "@example/files",
      }),
      expect.objectContaining({
        kind: "npm",
        transport: "stdio",
        supported: true,
        packageName: "@example/plain",
      }),
    ]);
    expect(item.installOptions[1].inputs).toEqual([
      expect.objectContaining({ key: "READ_ONLY", target: "env", defaultValue: "true" }),
      expect.objectContaining({ key: "--root", target: "arg", argumentType: "named" }),
    ]);
    expect(item.installOptions[1]).not.toHaveProperty("runtimeArgs");
  });

  it("rejects untrusted or SVG MCP icons and falls back to the GitHub publisher avatar", () => {
    const [item] = normalizeMcpRegistryResponse({
      servers: [{
        server: {
          name: "io.github.example/files",
          title: "Files",
          version: "1.2.3",
          websiteUrl: "https://example.com",
          repository: { url: "https://github.com/example/files" },
          icons: [
            { src: "https://tracker.invalid/icon.png", mimeType: "image/png" },
            { src: "https://example.com/icon.svg", mimeType: "image/svg+xml" },
          ],
        },
      }],
    });

    expect(item.iconUrl).toBe("https://github.com/example.png?size=80");
  });

  it("requests fifty entries from the Official MCP Registry by default", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      catalogResponse(
        "https://registry.modelcontextprotocol.io/v0.1/servers?limit=50&version=latest",
        JSON.stringify({ servers: [] }),
      ),
    );

    await searchMcpCatalog("");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0.1/servers?limit=50&version=latest",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("serves a recent MCP cache entry without requesting the upstream registry", async () => {
    const fetchedAt = new Date().toISOString();
    catalogStoreMocks.load.mockReturnValue({
      fetchedAt,
      items: [{
        id: "io.github.example/cached",
        name: "io.github.example/cached",
        title: "Cached MCP",
        description: "",
        version: "1.0.0",
        installOptions: [],
      }],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await searchMcpCatalog("cached");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetchedAt, freshness: "fresh" });
    expect(result.items[0]).toMatchObject({ name: "io.github.example/cached" });
  });

  it("deduplicates concurrent requests for the same MCP catalog query", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = searchMcpCatalog("parallel");
    const second = searchMcpCatalog("parallel");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.(catalogResponse(
      "https://registry.modelcontextprotocol.io/v0.1/servers?limit=50&version=latest&search=parallel",
      JSON.stringify({ servers: [] }),
    ));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(catalogStoreMocks.save).toHaveBeenCalledTimes(1);
  });

  it("ends a catalog request even when the underlying fetch never settles", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

    try {
      const assertion = expect(searchMcpCatalog(""))
        .rejects.toThrow("Catalog request timed out");
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables options that would persist registry-declared secrets", () => {
    const [item] = normalizeMcpRegistryResponse({
      servers: [{
        server: {
          name: "io.github.example/secret",
          version: "1.0.0",
          packages: [{
            registryType: "npm",
            identifier: "secret-server",
            version: "1.0.0",
            transport: { type: "stdio" },
            environmentVariables: [{
              name: "API_KEY",
              isRequired: true,
              isSecret: true,
              default: "must-not-be-cached",
            }],
          }],
        },
      }],
    });

    expect(item.installOptions[0].supported).toBe(false);
    expect(item.installOptions[0].inputs[0]).not.toHaveProperty("defaultValue");
  });
});

describe("MCP catalog install resolution", () => {
  it("builds a pinned npx command with environment and package arguments", () => {
    const forgedRuntime = { runtimeArgs: ["--package", "@attacker/override"] };
    const result = resolveMcpCatalogInstall({
      projectId: "project-1",
      optionId: "npm:0",
      values: {
        ROOT: "/workspace",
        "--read-only": "true",
      },
      item: {
        id: "io.github.example/files",
        name: "io.github.example/files",
        title: "Files",
        description: "",
        version: "1.2.3",
        installOptions: [{
          id: "npm:0",
          kind: "npm",
          transport: "stdio",
          label: "npm / stdio",
          supported: true,
          packageName: "@example/files",
          packageVersion: "1.2.3",
          ...forgedRuntime,
          inputs: [
            {
              key: "ROOT",
              label: "Root",
              required: true,
              secret: false,
              target: "env",
            },
            {
              key: "--read-only",
              label: "Read only",
              required: false,
              secret: false,
              target: "arg",
              argumentType: "named",
              argumentName: "--read-only",
            },
          ],
        }],
      },
    });

    expect(result).toEqual({
      ok: true,
      server: {
        name: "io.github.example/files",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@example/files@1.2.3", "--read-only"],
        env: { ROOT: "/workspace" },
      },
    });
  });

  it("rejects forged npm package identifiers", () => {
    const result = resolveMcpCatalogInstall({
      projectId: "project-1",
      optionId: "npm:0",
      values: {},
      item: {
        id: "bad",
        name: "io.github.example/bad",
        title: "Bad",
        description: "",
        version: "1.0.0",
        installOptions: [{
          id: "npm:0",
          kind: "npm",
          transport: "stdio",
          label: "npm / stdio",
          supported: true,
          packageName: "--package=bad",
          packageVersion: "1.0.0",
          inputs: [],
        }],
      },
    });

    expect(result).toEqual({ ok: false, error: "Invalid npm package name" });
  });
});
