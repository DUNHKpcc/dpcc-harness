import { memo } from "react";
import { useTranslation } from "react-i18next";
import { SunMoon, Layout, Blend, Wrench, Languages } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { useSettingsStore, deriveMacBackgroundEffect } from "@/stores/settings-store";
import { isMac } from "@/lib/utils";

// ── Props ──

interface AppearanceSettingsProps {
  /** Whether the platform supports transparency (glass/mica) */
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
}

// ── Component ──

export const AppearanceSettings = memo(function AppearanceSettings({
  glassSupported,
  macLiquidGlassSupported,
}: AppearanceSettingsProps) {
  const { t } = useTranslation("settings");
  // ── Read all appearance settings from the Zustand store ──
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const islandLayout = useSettingsStore((s) => s.islandLayout);
  const setIslandLayout = useSettingsStore((s) => s.setIslandLayout);
  const islandShine = useSettingsStore((s) => s.islandShine);
  const setIslandShine = useSettingsStore((s) => s.setIslandShine);
  const macBackgroundEffect = useSettingsStore((s) => deriveMacBackgroundEffect(s));
  const setMacBackgroundEffect = useSettingsStore((s) => s.setMacBackgroundEffect);
  const autoGroupTools = useSettingsStore((s) => s.autoGroupTools);
  const setAutoGroupTools = useSettingsStore((s) => s.setAutoGroupTools);
  const avoidGroupingEdits = useSettingsStore((s) => s.avoidGroupingEdits);
  const setAvoidGroupingEdits = useSettingsStore((s) => s.setAvoidGroupingEdits);
  const autoExpandTools = useSettingsStore((s) => s.autoExpandTools);
  const setAutoExpandTools = useSettingsStore((s) => s.setAutoExpandTools);
  const expandEditToolCallsByDefault = useSettingsStore((s) => s.expandEditToolCallsByDefault);
  const setExpandEditToolCallsByDefault = useSettingsStore((s) => s.setExpandEditToolCallsByDefault);
  const showToolIcons = useSettingsStore((s) => s.showToolIcons);
  const setShowToolIcons = useSettingsStore((s) => s.setShowToolIcons);
  const coloredToolIcons = useSettingsStore((s) => s.coloredToolIcons);
  const setColoredToolIcons = useSettingsStore((s) => s.setColoredToolIcons);
  const transparentToolPicker = useSettingsStore((s) => s.transparentToolPicker);
  const setTransparentToolPicker = useSettingsStore((s) => s.setTransparentToolPicker);
  const coloredSidebarIcons = useSettingsStore((s) => s.coloredSidebarIcons);
  const setColoredSidebarIcons = useSettingsStore((s) => s.setColoredSidebarIcons);
  const transparency = useSettingsStore((s) => s.transparency);
  const setTransparency = useSettingsStore((s) => s.setTransparency);

  const onThemeChange = setTheme;
  const onIslandLayoutChange = setIslandLayout;
  const onIslandShineChange = setIslandShine;
  const onMacBackgroundEffectChange = setMacBackgroundEffect;
  const onAutoGroupToolsChange = setAutoGroupTools;
  const onAvoidGroupingEditsChange = setAvoidGroupingEdits;
  const onAutoExpandToolsChange = setAutoExpandTools;
  const onExpandEditToolCallsByDefaultChange = setExpandEditToolCallsByDefault;
  const onShowToolIconsChange = setShowToolIcons;
  const onColoredToolIconsChange = setColoredToolIcons;
  const onTransparentToolPickerChange = setTransparentToolPicker;
  const onColoredSidebarIconsChange = setColoredSidebarIcons;
  const onTransparencyChange = setTransparency;

  const effectiveMacBackgroundEffect = !macLiquidGlassSupported && macBackgroundEffect === "liquid-glass"
    ? "vibrancy"
    : macBackgroundEffect;

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title={t("appearance.title")} description={t("appearance.description")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Language section ── */}
          <SettingsSection icon={Languages} label={t("appearance.language.section")} first>
            <SettingRow
              label={t("appearance.language.label")}
              description={t("appearance.language.description")}
            >
              <SettingsSelect
                value={language}
                onValueChange={setLanguage}
                options={[
                  { value: "system", label: t("appearance.language.system") },
                  { value: "en", label: t("appearance.language.en") },
                  { value: "zh", label: t("appearance.language.zh") },
                ]}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Theme section ── */}
          <SettingsSection icon={SunMoon} label={t("appearance.theme.section")}>
            <SettingRow
              label={t("appearance.theme.label")}
              description={t("appearance.theme.description")}
            >
              <SettingsSelect
                value={theme}
                onValueChange={onThemeChange}
                options={[
                  { value: "dark", label: t("appearance.theme.dark") },
                  { value: "light", label: t("appearance.theme.light") },
                  { value: "system", label: t("appearance.theme.system") },
                ]}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Tools section ── */}
          <SettingsSection icon={Wrench} label={t("appearance.tools.section")}>
            <SettingRow
              label={t("appearance.tools.autoGroup")}
              description={t("appearance.tools.autoGroupDesc")}
            >
              <Switch
                checked={autoGroupTools}
                onCheckedChange={onAutoGroupToolsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.tools.avoidGroupingEdits")}
              description={t("appearance.tools.avoidGroupingEditsDesc")}
            >
              <Switch
                checked={avoidGroupingEdits}
                onCheckedChange={onAvoidGroupingEditsChange}
                disabled={!autoGroupTools}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.tools.autoExpand")}
              description={t("appearance.tools.autoExpandDesc")}
            >
              <Switch
                checked={autoExpandTools}
                onCheckedChange={onAutoExpandToolsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.tools.expandEditWrite")}
              description={t("appearance.tools.expandEditWriteDesc")}
            >
              <Switch
                checked={expandEditToolCallsByDefault}
                onCheckedChange={onExpandEditToolCallsByDefaultChange}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.tools.showIcons")}
              description={t("appearance.tools.showIconsDesc")}
            >
              <Switch
                checked={showToolIcons}
                onCheckedChange={onShowToolIconsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.tools.coloredIcons")}
              description={t("appearance.tools.coloredIconsDesc")}
            >
              <Switch
                checked={coloredToolIcons}
                onCheckedChange={onColoredToolIconsChange}
                disabled={!showToolIcons}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Layout section ── */}
          <SettingsSection icon={Layout} label={t("appearance.layout.section")}>
            <div className="py-3">
              <p className="text-sm font-medium text-foreground">{t("appearance.layout.windowLayout")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("appearance.layout.windowLayoutDesc")}
              </p>
              <div className="mt-3 flex gap-3">
                {/* ── Island preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(true)}
                >
                  {/* Mini app illustration — islands with gaps and rounded corners */}
                  <div className="flex h-[72px] gap-1 rounded-md bg-foreground/[0.04] p-1.5">
                    {/* Sidebar */}
                    <div className="w-[26%] rounded-[5px] bg-foreground/[0.07]" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      {/* Bottom bar hint */}
                      <div className="h-2.5 rounded-[4px] bg-foreground/[0.05]" />
                    </div>
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      <div className="h-[40%] rounded-[5px] bg-foreground/[0.07]" />
                    </div>
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {t("appearance.layout.islands")}
                  </p>
                </button>

                {/* ── Flat preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    !islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(false)}
                >
                  {/* Mini app illustration — flat edge-to-edge with 1px dividers */}
                  <div className="flex h-[72px] overflow-hidden rounded-md bg-foreground/[0.04]">
                    {/* Sidebar */}
                    <div className="w-[26%] bg-foreground/[0.07]" />
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-2.5 bg-foreground/[0.05]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-[40%] bg-foreground/[0.07]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 bg-foreground/[0.04] pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    !islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {t("appearance.layout.flat")}
                  </p>
                </button>
              </div>
            </div>

            <SettingRow
              label={t("appearance.layout.coloredSidebarIcons")}
              description={t("appearance.layout.coloredSidebarIconsDesc")}
            >
              <Switch
                checked={coloredSidebarIcons}
                onCheckedChange={onColoredSidebarIconsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("appearance.layout.islandShine")}
              description={t("appearance.layout.islandShineDesc")}
            >
              <Switch
                checked={islandShine}
                onCheckedChange={onIslandShineChange}
                disabled={!islandLayout}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Transparency section ── */}
          <SettingsSection icon={Blend} label={t("appearance.transparency.section")}>
            <SettingRow
              label={isMac ? t("appearance.transparency.macLabel") : t("appearance.transparency.winLabel")}
              description={
                isMac
                  ? (
                    macLiquidGlassSupported
                      ? t("appearance.transparency.macDescGlass")
                      : t("appearance.transparency.macDescNoGlass")
                  )
                  : (
                    glassSupported
                      ? t("appearance.transparency.winDescSupported")
                      : t("appearance.transparency.winDescUnsupported")
                  )
              }
            >
              {isMac ? (
                <SettingsSelect
                  value={effectiveMacBackgroundEffect}
                  onValueChange={onMacBackgroundEffectChange}
                  options={[
                    ...(macLiquidGlassSupported
                      ? [{ value: "liquid-glass" as const, label: t("appearance.transparency.liquidGlass") }]
                      : []),
                    { value: "vibrancy", label: t("appearance.transparency.vibrancy") },
                    { value: "off", label: t("appearance.transparency.blurOff") },
                  ]}
                  className="min-w-[9.5rem]"
                />
              ) : (
                <Switch
                  checked={transparency}
                  onCheckedChange={onTransparencyChange}
                  disabled={!glassSupported}
                />
              )}
            </SettingRow>

            <SettingRow
              label={t("appearance.transparency.transparentToolPicker")}
              description={t("appearance.transparency.transparentToolPickerDesc")}
            >
              <Switch
                checked={transparentToolPicker}
                onCheckedChange={onTransparentToolPickerChange}
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
