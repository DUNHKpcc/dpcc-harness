import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { McpTransport, McpServerConfig } from "@/types";
import { parseKeyValuePairs } from "./mcp-utils";

const TRANSPORTS: McpTransport[] = ["stdio", "sse", "http"];

export interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (server: McpServerConfig) => void;
}

/** Dialog for adding a new MCP server with transport-conditional form fields. */
export const AddServerDialog = memo(function AddServerDialog({
  open,
  onOpenChange,
  onAdd,
}: AddServerDialogProps) {
  const { t } = useTranslation("tools");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");

  const resetForm = useCallback(() => {
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgs("");
    setEnvText("");
    setUrl("");
    setHeadersText("");
  }, []);

  const handleAdd = useCallback(() => {
    if (!name.trim()) return;

    const server: McpServerConfig = {
      name: name.trim(),
      transport,
    };

    if (transport === "stdio") {
      if (!command.trim()) return;
      server.command = command.trim();
      if (args.trim()) server.args = args.trim().split(/\s+/);
      const env = parseKeyValuePairs(envText);
      if (Object.keys(env).length > 0) server.env = env;
    } else {
      if (!url.trim()) return;
      server.url = url.trim();
      const headers = parseKeyValuePairs(headersText);
      if (Object.keys(headers).length > 0) server.headers = headers;
    }

    onAdd(server);
    resetForm();
  }, [name, transport, command, args, envText, url, headersText, onAdd, resetForm]);

  const canSubmit = name.trim() && (transport === "stdio" ? command.trim() : url.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-sm">{t("mcp.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("mcp.dialog.name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("mcp.dialog.namePlaceholder")}
              className="h-8 text-xs"
            />
          </div>

          {/* Transport */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("mcp.dialog.transport")}</label>
            <div className="flex gap-1">
              {TRANSPORTS.map((t) => (
                <Button
                  key={t}
                  variant={transport === t ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={() => setTransport(t)}
                >
                  {t.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {/* Conditional fields */}
          {transport === "stdio" ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t("mcp.dialog.command")}</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-github"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("mcp.dialog.arguments")} <span className="text-muted-foreground/60">{t("mcp.dialog.argumentsHint")}</span>
                </label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="--config config.json"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("mcp.dialog.envVars")} <span className="text-muted-foreground/60">{t("mcp.dialog.envVarsHint")}</span>
                </label>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={"GITHUB_TOKEN=ghp_...\nAPI_KEY=sk-..."}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
                  rows={3}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t("mcp.dialog.url")}</label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.example.com/mcp"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("mcp.dialog.headers")} <span className="text-muted-foreground/60">{t("mcp.dialog.headersHint")}</span>
                </label>
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={"Authorization=Bearer token123"}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
                  rows={2}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
          >
            {t("action.cancel", { ns: "common" })}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleAdd}
            disabled={!canSubmit}
          >
            {t("mcp.dialog.addServer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
