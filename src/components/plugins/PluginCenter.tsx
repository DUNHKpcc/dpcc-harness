import { Suspense, lazy, memo } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkillsCatalog } from "./SkillsCatalog";
import type { McpServerConfig } from "@/types";

const McpCatalog = lazy(() =>
  import("./McpCatalog").then((module) => ({ default: module.McpCatalog })),
);

interface PluginCenterProps {
  hasLiveSession: boolean;
  isSessionProcessing: boolean;
  onRestartWithServers?: (servers: McpServerConfig[]) => Promise<void> | void;
}

function CatalogPanelFallback() {
  return (
    <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto w-full max-w-5xl animate-pulse px-5 pt-10 sm:px-8">
        <div className="h-8 w-24 rounded bg-muted" />
        <div className="mt-3 h-5 w-64 max-w-full rounded bg-muted/70" />
        <div className="mt-8 h-10 w-full rounded-md bg-muted/70" />
      </div>
    </div>
  );
}

export const PluginCenter = memo(function PluginCenter({
  hasLiveSession,
  isSessionProcessing,
  onRestartWithServers,
}: PluginCenterProps) {
  const { t } = useTranslation("plugins");

  return (
    <div data-plugin-center="true" className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <Tabs defaultValue="skills" className="min-h-0 min-w-0 flex-1 gap-0">
        <div className="flex h-12 shrink-0 items-center border-b border-border/60 px-4">
          <TabsList className="h-9 gap-1 bg-transparent p-0">
            <TabsTrigger
              value="skills"
              data-plugin-tab="skills"
              className="h-8 flex-none px-3 text-sm data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              {t("tabs.skills")}
            </TabsTrigger>
            <TabsTrigger
              value="mcp"
              data-plugin-tab="mcp"
              className="h-8 flex-none px-3 text-sm data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              {t("tabs.mcp")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="skills" className="m-0 flex min-h-0 min-w-0 flex-1">
          <SkillsCatalog />
        </TabsContent>
        <TabsContent value="mcp" className="m-0 flex min-h-0 min-w-0 flex-1">
          <Suspense fallback={<CatalogPanelFallback />}>
            <McpCatalog
              hasLiveSession={hasLiveSession}
              isSessionProcessing={isSessionProcessing}
              onRestartWithServers={onRestartWithServers}
            />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
});
