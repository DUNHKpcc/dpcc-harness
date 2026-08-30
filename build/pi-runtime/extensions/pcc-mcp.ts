import fs from "node:fs";
import { pathToFileURL } from "node:url";

export default async function installPccMcp(pi: unknown): Promise<void> {
  const adapterPath = process.env.PCC_AGENT_PI_MCP_ADAPTER?.trim();
  const configPath = process.env.PCC_AGENT_PI_MCP_CONFIG?.trim();
  if (!adapterPath || !configPath) {
    throw new Error("PccAgent Pi MCP configuration is incomplete.");
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  const adapter = await import(pathToFileURL(adapterPath).href) as {
    createMcpAdapter?: (options: { config: unknown }) => (api: unknown) => void | Promise<void>;
  };
  if (typeof adapter.createMcpAdapter !== "function") {
    throw new Error("PccAgent bundled Pi MCP adapter is invalid.");
  }
  await adapter.createMcpAdapter({ config })(pi);
}
