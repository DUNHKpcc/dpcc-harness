import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

interface SeededProject {
  id: string;
  name: string;
  path: string;
}

interface ConfigureRendererOptions {
  welcomeCompleted?: boolean;
}

interface SeedProjectAndSessionOptions {
  model?: string;
  contextUsage?: unknown;
  piContextSnapshots?: unknown[];
  messages?: unknown[];
}

export async function configureRenderer(
  page: Page,
  { welcomeCompleted = true }: ConfigureRendererOptions = {},
): Promise<void> {
  await page.evaluate(({ completed }) => {
    window.localStorage.clear();
    window.localStorage.setItem("pcc-agent-language", "en");
    if (completed) {
      window.localStorage.setItem("pcc-agent-welcome-completed", "true");
    }
  }, { completed: welcomeCompleted });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor();
}

export async function seedProjectAndSession(
  page: Page,
  {
    model = "fixture/model",
    contextUsage,
    piContextSnapshots,
    messages,
  }: SeedProjectAndSessionOptions = {},
): Promise<SeededProject> {
  const project = await page.evaluate(async () => {
    const bridge = (window as typeof window & {
      claude: { projects: { createDev: (name: string) => Promise<SeededProject | null> } };
    }).claude;
    return bridge.projects.createDev("Playwright Workspace");
  });
  if (!project) throw new Error("Playwright fixture project could not be created.");

  fs.mkdirSync(path.join(project.path, "src"), { recursive: true });
  fs.mkdirSync(path.join(project.path, "notes"), { recursive: true });
  fs.writeFileSync(path.join(project.path, "README.md"), "# Playwright Workspace\n\nUI fixture project.\n", "utf8");
  fs.writeFileSync(path.join(project.path, "src", "workspace.ts"), "export const ready = true;\n", "utf8");
  fs.writeFileSync(path.join(project.path, "notes", "overview.md"), "# Overview\n\nStable UI workflow.\n", "utf8");

  const saved = await page.evaluate(async ({
    projectId,
    sessionModel,
    sessionContextUsage,
    sessionPiContextSnapshots,
    sessionMessages,
  }) => {
    const bridge = (window as typeof window & {
      claude: { sessions: { save: (value: unknown) => Promise<{ ok?: boolean; error?: string }> } };
    }).claude;
    const now = Date.now();
    return bridge.sessions.save({
      id: "playwright-session",
      projectId,
      title: "Playwright Session",
      createdAt: now,
      lastMessageAt: now,
      engine: "acp",
      agentId: "pi-acp",
      model: sessionModel,
      permissionMode: "default",
      messages: sessionMessages ?? [
        { id: "playwright-user", role: "user", content: "Inspect the workspace fixture", timestamp: now },
        { id: "playwright-assistant", role: "assistant", content: "The workspace fixture is ready.", timestamp: now + 1, isStreaming: false },
      ],
      totalCost: 0,
      isProcessing: false,
      ...(sessionContextUsage ? { contextUsage: sessionContextUsage } : {}),
      ...(sessionPiContextSnapshots ? { piContextSnapshots: sessionPiContextSnapshots } : {}),
    });
  }, {
    projectId: project.id,
    sessionModel: model,
    sessionContextUsage: contextUsage,
    sessionPiContextSnapshots: piContextSnapshots,
    sessionMessages: messages,
  });
  if (saved.error) throw new Error(saved.error);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor();
  return project;
}

export function seedLocalSkills(home: string, count = 8): void {
  for (let index = 1; index <= count; index += 1) {
    const name = `playwright-skill-${index}`;
    const directory = path.join(home, ".agents", "skills", name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Playwright UI fixture ${index}\n---\n\n# ${name}\n`,
      "utf8",
    );
  }
}

export function seedLocalMcpServers(home: string): void {
  fs.writeFileSync(path.join(home, ".mcp.json"), JSON.stringify({
    mcpServers: {
      "local-fixture": { command: "node", args: ["local-mcp.js"] },
    },
  }), "utf8");
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({
    mcpServers: {
      "claude-fixture": { url: "https://example.com/claude-mcp" },
    },
  }), "utf8");

  const codexDirectory = path.join(home, ".codex");
  fs.mkdirSync(codexDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(codexDirectory, "config.toml"),
    '[mcp_servers.codex-fixture]\ncommand = "node"\nargs = ["codex-mcp.js"]\n',
    "utf8",
  );
}
