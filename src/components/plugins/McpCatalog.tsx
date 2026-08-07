import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, ExternalLink, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PluginIcon, repositoryPublisherIconUrl } from "./PluginIcon";
import type {
  CatalogFreshness,
  EngineId,
  McpCatalogInstallOption,
  McpCatalogItem,
  McpServerConfig,
} from "@/types";

interface McpCatalogProps {
  projectId: string | null;
  projectName: string | null;
  activeEngine?: EngineId;
  hasLiveSession: boolean;
  isSessionProcessing: boolean;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

export function McpCatalog({
  projectId,
  projectName,
  activeEngine,
  hasLiveSession,
  isSessionProcessing,
  onRestartWithServers,
}: McpCatalogProps) {
  const { t } = useTranslation("plugins");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<McpCatalogItem[]>([]);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [freshness, setFreshness] = useState<CatalogFreshness>("fresh");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<McpCatalogItem | null>(null);
  const [optionId, setOptionId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);

  const refreshInstalled = useCallback(async () => {
    if (!projectId) {
      setServers([]);
      return;
    }
    setServers(await window.claude.mcp.list(projectId));
  }, [projectId]);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void window.claude.plugins.mcp.list(query.trim()).then((response) => {
        if (cancelled) return;
        if ("error" in response) {
          setError(response.error);
          setItems([]);
        } else {
          setItems(response.items);
          setFreshness(response.freshness);
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, query.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const installedNames = useMemo(() => new Set(servers.map((server) => server.name)), [servers]);
  const catalogItemsByName = useMemo(
    () => new Map(items.map((item) => [item.name, item])),
    [items],
  );
  const selectedOption = useMemo(
    () => selected?.installOptions.find((option) => option.id === optionId) ?? null,
    [optionId, selected],
  );
  const installPreview = useMemo(() => {
    if (!selectedOption) return "";
    if (selectedOption.kind === "remote") return selectedOption.urlTemplate ?? "";
    if (!selectedOption.packageName) return "";
    const packageRef = selectedOption.packageVersion
      ? `${selectedOption.packageName}@${selectedOption.packageVersion}`
      : selectedOption.packageName;
    return `npx -y ${packageRef}`;
  }, [selectedOption]);

  const openInstall = useCallback((item: McpCatalogItem) => {
    const option = item.installOptions.find((candidate) => candidate.supported)
      ?? item.installOptions[0]
      ?? null;
    setSelected(item);
    setOptionId(option?.id ?? "");
    setValues(Object.fromEntries(
      option?.inputs
        .filter((input) => input.defaultValue)
        .map((input) => [input.key, input.defaultValue ?? ""]) ?? [],
    ));
  }, []);

  const changeOption = useCallback((option: McpCatalogInstallOption) => {
    setOptionId(option.id);
    setValues(Object.fromEntries(
      option.inputs
        .filter((input) => input.defaultValue)
        .map((input) => [input.key, input.defaultValue ?? ""]),
    ));
  }, []);

  const restartSession = useCallback(async () => {
    if (!projectId || !hasLiveSession || !onRestartWithServers) return;
    if (isSessionProcessing) {
      toast.info(t("state.sessionBusy"));
      return;
    }
    if (activeEngine === "codex") {
      toast.info(t("state.codexRestart"));
      return;
    }
    await onRestartWithServers(await window.claude.mcp.list(projectId));
  }, [activeEngine, hasLiveSession, isSessionProcessing, onRestartWithServers, projectId, t]);

  const handleInstall = useCallback(async () => {
    if (
      !selected
      || !selectedOption
      || !projectId
      || !selectedOption.supported
      || isSessionProcessing
    ) return;
    setInstalling(true);
    const response = await window.claude.plugins.mcp.install({
      projectId,
      item: selected,
      optionId: selectedOption.id,
      values,
    });
    setInstalling(false);
    if (!response.ok) {
      toast.error(response.error);
      return;
    }
    toast.success(t("mcp.installSuccess", { name: selected.title }));
    setSelected(null);
    await refreshInstalled();
    await restartSession();
  }, [isSessionProcessing, projectId, refreshInstalled, restartSession, selected, selectedOption, t, values]);

  const handleRemove = useCallback(async (server: McpServerConfig) => {
    if (!projectId || isSessionProcessing) return;
    setRemovingName(server.name);
    const response = await window.claude.mcp.remove(projectId, server.name);
    setRemovingName(null);
    if (response.error) {
      toast.error(response.error);
      return;
    }
    toast.success(t("mcp.removeSuccess", { name: server.name }));
    await refreshInstalled();
    await restartSession();
  }, [isSessionProcessing, projectId, refreshInstalled, restartSession, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div
          data-mcp-catalog-layout="reference"
          className="mx-auto w-full max-w-5xl px-5 pb-12 pt-8 sm:px-8 sm:pt-10"
        >
          <header>
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-foreground">{t("tabs.mcp")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t("mcp.subtitle")}</p>
              </div>
              {projectName && (
                <span className="max-w-64 truncate text-xs text-muted-foreground">
                  {t("mcp.project", { name: projectName })}
                </span>
              )}
            </div>
            <label className="relative mt-7 block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search.mcp")}
                className="h-11 rounded-full border-border/80 bg-background pl-11 pr-4 text-sm shadow-none"
              />
            </label>
          </header>

          <section data-installed-strip="mcp" className="mt-9">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-semibold">{t("views.installed")}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{servers.length}</span>
            </div>
            {!projectId ? (
              <p className="py-5 text-sm text-muted-foreground">{t("state.projectRequired")}</p>
            ) : servers.length === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">{t("state.noInstalledMcp")}</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto py-4">
                {servers.map((server) => (
                  <div
                    key={server.name}
                    className="flex h-14 w-64 shrink-0 items-center gap-3 rounded-md border border-border/65 bg-background px-2.5"
                  >
                    <PluginIcon
                      name={server.name}
                      imageUrl={catalogItemsByName.get(server.name)?.iconUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{server.name}</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="shrink-0 uppercase">{server.transport}</span>
                        <span className="truncate">{server.url ?? server.command}</span>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={isSessionProcessing || removingName === server.name}
                      onClick={() => void handleRemove(server)}
                      title={isSessionProcessing ? t("state.sessionBusy") : t("action.remove")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-sm font-semibold">{t("views.discover")}</h2>
              <span className="text-[11px] text-muted-foreground">
                {freshness === "stale" ? t("source.stale") : t("source.mcp")}
              </span>
            </div>

            {error ? (
              <div className="py-12 text-center text-sm text-destructive">{error}</div>
            ) : loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("state.loading")}</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("state.empty")}</div>
            ) : (
              <div data-plugin-catalog-grid="mcp" className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
                {items.map((item) => {
                  const installed = installedNames.has(item.name);
                  const supported = item.installOptions.some((option) => option.supported);
                  return (
                    <div
                      key={`${item.id}@${item.version}`}
                      className="flex min-h-28 items-center gap-3 border-b border-border/55 py-4"
                    >
                      <PluginIcon
                        name={item.title}
                        imageUrl={item.iconUrl ?? repositoryPublisherIconUrl(item.repositoryUrl)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          {installed && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                          {item.description || item.name}
                        </p>
                        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="shrink-0">v{item.version}</span>
                          <span className="truncate">
                            {item.installOptions.map((option) => option.label).join(" · ")}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 rounded-full px-3"
                        disabled={!projectId || !supported || isSessionProcessing}
                        onClick={() => openInstall(item)}
                        title={isSessionProcessing
                          ? t("state.sessionBusy")
                          : !projectId
                            ? t("state.projectRequired")
                            : !supported
                              ? t("mcp.unsupported")
                              : undefined}
                      >
                        {t(installed ? "action.update" : "action.install")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="rounded-lg sm:max-w-lg">
          <DialogHeader>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>{selected?.title}</DialogTitle>
                <DialogDescription>{selected?.name}</DialogDescription>
              </div>
              {selected?.repositoryUrl && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => void window.claude.openExternal(selected.repositoryUrl!)}
                  title={t("mcp.openSource")}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {installPreview && (
              <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                  {t("mcp.installPreview")}
                </div>
                <code className="block break-all text-[11px] leading-5 text-foreground/80">
                  {installPreview}
                </code>
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-medium">{t("mcp.transport")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {selected?.installOptions.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={option.id === optionId ? "secondary" : "outline"}
                    className="h-auto min-h-9 justify-start text-left"
                    disabled={!option.supported}
                    onClick={() => changeOption(option)}
                    title={!option.supported ? t("mcp.unsupported") : undefined}
                  >
                    <span className="truncate">{option.label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {selectedOption && selectedOption.inputs.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-medium">{t("mcp.configuration")}</div>
                {selectedOption.inputs.map((input) => (
                  <label key={`${input.target}:${input.key}`} className="block space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      {input.label}{input.required ? " *" : ""}
                    </span>
                    <Input
                      type={input.secret ? "password" : "text"}
                      value={values[input.key] ?? ""}
                      disabled={input.secret}
                      onChange={(event) => setValues((current) => ({
                        ...current,
                        [input.key]: event.target.value,
                      }))}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>{t("action.cancel")}</Button>
            <Button
              onClick={() => void handleInstall()}
              disabled={!projectId || !selectedOption?.supported || installing || isSessionProcessing}
              title={isSessionProcessing ? t("state.sessionBusy") : undefined}
            >
              <Download className="h-4 w-4" />
              {t("action.confirmInstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
