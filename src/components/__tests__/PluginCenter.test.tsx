import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpCatalog } from "../plugins/McpCatalog";
import { PluginCenter } from "../plugins/PluginCenter";
import { PluginIcon } from "../plugins/PluginIcon";

const repoRoot = path.resolve(__dirname, "../../..");

describe("Plugin Center workspace", () => {
  it("renders Skills and MCP as first-class workspace tabs", () => {
    const markup = renderToStaticMarkup(
      <PluginCenter
        hasLiveSession={false}
        isSessionProcessing={false}
      />,
    );

    expect(markup).toContain('data-plugin-center="true"');
    expect(markup).toContain('data-plugin-tab="skills"');
    expect(markup).toContain('data-plugin-tab="mcp"');
    expect(markup).toContain('data-skill-catalog-layout="reference"');
    expect(markup).toContain('data-installed-strip="skills"');
    expect(markup).not.toContain('data-mcp-catalog-layout="reference"');
  });

  it("uses the same reference layout for the MCP catalog", () => {
    const markup = renderToStaticMarkup(
      <McpCatalog
        hasLiveSession={false}
        isSessionProcessing={false}
      />,
    );

    expect(markup).toContain('data-mcp-catalog-layout="reference"');
    expect(markup).toContain('data-installed-strip="mcp"');
  });

  it("renders upstream artwork and a deterministic fallback for plugin icons", () => {
    const imageMarkup = renderToStaticMarkup(
      <PluginIcon name="Example MCP" imageUrl="https://example.com/icon.png" />,
    );
    const fallbackMarkup = renderToStaticMarkup(<PluginIcon name="Example Skill" />);

    expect(imageMarkup).toContain('data-plugin-icon="image"');
    expect(imageMarkup).toContain('src="https://example.com/icon.png"');
    expect(fallbackMarkup).toContain('data-plugin-icon="fallback"');
    expect(fallbackMarkup).toContain("ES");
  });

  it("keeps Plugins and ACP Agents in the fixed sidebar order", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "src/components/sidebar/SidebarTopActions.tsx"),
      "utf8",
    );

    const newChatIndex = source.indexOf("onClick={onCreateChat}");
    const searchIndex = source.indexOf("<SidebarSearch");
    const pluginsIndex = source.indexOf("<SidebarPluginEntry");
    const acpIndex = source.indexOf('data-sidebar-acp-agents-entry="true"');

    expect(newChatIndex).toBeGreaterThan(-1);
    expect(searchIndex).toBeGreaterThan(newChatIndex);
    expect(pluginsIndex).toBeGreaterThan(searchIndex);
    expect(acpIndex).toBeGreaterThan(pluginsIndex);
  });

  it("opens Plugins and ACP Agents in the main workspace instead of Settings", () => {
    const appLayout = fs.readFileSync(
      path.join(repoRoot, "src/components/AppLayout.tsx"),
      "utf8",
    );
    const pluginCenter = fs.readFileSync(
      path.join(repoRoot, "src/components/plugins/PluginCenter.tsx"),
      "utf8",
    );
    const skillsCatalog = fs.readFileSync(
      path.join(repoRoot, "src/components/plugins/SkillsCatalog.tsx"),
      "utf8",
    );
    const mcpCatalog = fs.readFileSync(
      path.join(repoRoot, "src/components/plugins/McpCatalog.tsx"),
      "utf8",
    );
    const settings = fs.readFileSync(
      path.join(repoRoot, "src/components/SettingsView.tsx"),
      "utf8",
    );

    expect(appLayout).toContain('handleOpenSidebarWorkspace("plugins")');
    expect(appLayout).toContain('handleOpenSidebarWorkspace("acp-agents")');
    expect(appLayout).toContain("<PluginCenter");
    expect(appLayout).toContain("<AgentSettings");
    expect(appLayout).not.toContain('setShowSettings("agents")');
    expect(settings).not.toContain('{ id: "agents"');
    expect(appLayout).toContain("const PluginCenter = lazy(() =>");
    expect(appLayout).not.toContain('import { PluginCenter } from "./plugins/PluginCenter"');
    expect(pluginCenter).toContain("const McpCatalog = lazy(() =>");
    expect(pluginCenter).not.toContain('import { McpCatalog } from "./McpCatalog"');
    expect(appLayout).toContain("isSessionProcessing={manager.isProcessing}");
    expect(pluginCenter).toContain("isSessionProcessing={isSessionProcessing}");
    expect(mcpCatalog).toContain("isSessionProcessing || removingName === server.name");
    expect(mcpCatalog).toContain("!selectedOption.supported\n      || isSessionProcessing");
    expect(skillsCatalog).toContain("listInstalled()");
    expect(skillsCatalog).not.toContain("projectPath");
    expect(skillsCatalog).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]");
    expect(skillsCatalog).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,21rem),1fr))]");
    expect(skillsCatalog).toContain('data-installed-list="skills"');
    expect(skillsCatalog).toContain("max-h-[156px]");
    expect(skillsCatalog).toContain("overflow-y-auto");
    expect(skillsCatalog).not.toContain("overflow-x-auto");
    expect(mcpCatalog).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]");
    expect(mcpCatalog).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,21rem),1fr))]");
    expect(mcpCatalog).toContain('data-installed-list="mcp"');
    expect(mcpCatalog).toContain("max-h-[156px]");
    expect(mcpCatalog).toContain("overflow-y-auto");
    expect(mcpCatalog).not.toContain("overflow-x-auto");
  });
});
