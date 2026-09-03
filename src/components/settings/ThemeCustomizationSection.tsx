import { memo, useCallback, useRef } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Copy, FileUp, Palette, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsSelect, SettingsSection } from "@/components/settings/shared";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DEFAULT_ACCENT_COLOR,
  getAccentForeground,
} from "@/lib/theme-colors";
import {
  DEFAULT_DARK_BACKGROUND_COLOR,
  DEFAULT_DARK_FOREGROUND_COLOR,
  DEFAULT_LIGHT_BACKGROUND_COLOR,
  DEFAULT_LIGHT_FOREGROUND_COLOR,
  DEFAULT_THEME_CUSTOMIZATION,
  parseThemeCustomization,
  serializeThemeCustomization,
  type CodeFontFamily,
  type ThemeCustomization,
  type ThemeFontWeight,
  type UiFontFamily,
} from "@/lib/theme-customization";
import { copyToClipboard } from "@/lib/clipboard";

interface ThemeCustomizationSectionProps {
  resolvedTheme: "light" | "dark";
}

interface ColorControlProps {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (value: string) => void;
}

function ColorControl({ label, value, fallback, onChange }: ColorControlProps) {
  const displayedColor = value ?? fallback;
  const controlStyle: CSSProperties = {
    backgroundColor: displayedColor,
    color: getAccentForeground(displayedColor),
  };

  return (
    <label
      className="relative flex h-9 min-w-40 items-center gap-2 rounded-lg px-3 text-sm font-medium shadow-sm transition-opacity hover:opacity-90"
      style={controlStyle}
    >
      <span className="h-4 w-4 shrink-0 rounded-full border border-current/25 bg-transparent" />
      <span className="font-mono text-xs">{displayedColor.toUpperCase()}</span>
      <input
        type="color"
        value={displayedColor}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

const UI_FONT_OPTIONS: Array<{ value: UiFontFamily; labelKey: string }> = [
  { value: "system", labelKey: "system" },
  { value: "source-serif", labelKey: "sourceSerif" },
  { value: "instrument-serif", labelKey: "instrumentSerif" },
];

const CODE_FONT_OPTIONS: Array<{ value: CodeFontFamily; labelKey: string }> = [
  { value: "system", labelKey: "system" },
  { value: "cascadia", labelKey: "cascadia" },
  { value: "courier", labelKey: "courier" },
];

const FONT_WEIGHT_OPTIONS: Array<{ value: ThemeFontWeight; labelKey: string }> = [
  { value: "400", labelKey: "regular" },
  { value: "500", labelKey: "medium" },
  { value: "600", labelKey: "semibold" },
  { value: "700", labelKey: "bold" },
];

function getCustomizationSnapshot(state: ThemeCustomization): ThemeCustomization {
  return {
    accentColor: state.accentColor,
    lightBackgroundColor: state.lightBackgroundColor,
    lightForegroundColor: state.lightForegroundColor,
    darkBackgroundColor: state.darkBackgroundColor,
    darkForegroundColor: state.darkForegroundColor,
    uiFontFamily: state.uiFontFamily,
    uiFontWeight: state.uiFontWeight,
    codeFontFamily: state.codeFontFamily,
    codeFontWeight: state.codeFontWeight,
    sidebarTransparency: state.sidebarTransparency,
    contrast: state.contrast,
  };
}

export const ThemeCustomizationSection = memo(function ThemeCustomizationSection({
  resolvedTheme,
}: ThemeCustomizationSectionProps) {
  const { t } = useTranslation("settings");
  const importInputRef = useRef<HTMLInputElement>(null);
  const state = useSettingsStore(
    useShallow((settings) => ({
      accentColor: settings.accentColor,
      lightBackgroundColor: settings.lightBackgroundColor,
      lightForegroundColor: settings.lightForegroundColor,
      darkBackgroundColor: settings.darkBackgroundColor,
      darkForegroundColor: settings.darkForegroundColor,
      uiFontFamily: settings.uiFontFamily,
      uiFontWeight: settings.uiFontWeight,
      codeFontFamily: settings.codeFontFamily,
      codeFontWeight: settings.codeFontWeight,
      sidebarTransparency: settings.sidebarTransparency,
      contrast: settings.contrast,
      setAccentColor: settings.setAccentColor,
      setLightBackgroundColor: settings.setLightBackgroundColor,
      setLightForegroundColor: settings.setLightForegroundColor,
      setDarkBackgroundColor: settings.setDarkBackgroundColor,
      setDarkForegroundColor: settings.setDarkForegroundColor,
      setUiFontFamily: settings.setUiFontFamily,
      setUiFontWeight: settings.setUiFontWeight,
      setCodeFontFamily: settings.setCodeFontFamily,
      setCodeFontWeight: settings.setCodeFontWeight,
      setSidebarTransparency: settings.setSidebarTransparency,
      setContrast: settings.setContrast,
      setThemeCustomization: settings.setThemeCustomization,
    })),
  );
  const theme = getCustomizationSnapshot(state);
  const isDark = resolvedTheme === "dark";
  const backgroundColor = isDark ? state.darkBackgroundColor : state.lightBackgroundColor;
  const foregroundColor = isDark ? state.darkForegroundColor : state.lightForegroundColor;
  const backgroundFallback = isDark ? DEFAULT_DARK_BACKGROUND_COLOR : DEFAULT_LIGHT_BACKGROUND_COLOR;
  const foregroundFallback = isDark ? DEFAULT_DARK_FOREGROUND_COLOR : DEFAULT_LIGHT_FOREGROUND_COLOR;

  const setBackgroundColor = isDark ? state.setDarkBackgroundColor : state.setLightBackgroundColor;
  const setForegroundColor = isDark ? state.setDarkForegroundColor : state.setLightForegroundColor;

  const handleCopyTheme = useCallback(async () => {
    const ok = await copyToClipboard(serializeThemeCustomization(theme));
    if (ok) toast.success(t("appearance.customization.copySuccess"));
    else toast.error(t("appearance.customization.copyFailed"));
  }, [t, theme]);

  const handleImportTheme = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    let imported: ThemeCustomization | null;
    try {
      imported = parseThemeCustomization(await file.text());
    } catch {
      imported = null;
    }
    if (!imported) {
      toast.error(t("appearance.customization.importFailed"));
      return;
    }

    state.setThemeCustomization(imported);
    toast.success(t("appearance.customization.importSuccess"));
  }, [state.setThemeCustomization, t]);

  const handleReset = useCallback(() => {
    state.setThemeCustomization(DEFAULT_THEME_CUSTOMIZATION);
  }, [state.setThemeCustomization]);

  return (
    <SettingsSection icon={Palette} label={t("appearance.customization.section")}>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void handleImportTheme(event)}
      />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            {t(isDark ? "appearance.customization.darkTheme" : "appearance.customization.lightTheme")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("appearance.customization.description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => importInputRef.current?.click()}
          >
            <FileUp className="h-3.5 w-3.5" />
            {t("appearance.customization.import")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopyTheme()}>
            <Copy className="h-3.5 w-3.5" />
            {t("appearance.customization.copy")}
          </Button>
        </div>
      </div>

      <SettingRow label={t("appearance.customization.accent")}>
        <ColorControl
          label={t("appearance.customization.accent")}
          value={state.accentColor}
          fallback={DEFAULT_ACCENT_COLOR}
          onChange={state.setAccentColor}
        />
      </SettingRow>

      <SettingRow label={t("appearance.customization.background")}>
        <ColorControl
          label={t("appearance.customization.background")}
          value={backgroundColor}
          fallback={backgroundFallback}
          onChange={setBackgroundColor}
        />
      </SettingRow>

      <SettingRow label={t("appearance.customization.foreground")}>
        <ColorControl
          label={t("appearance.customization.foreground")}
          value={foregroundColor}
          fallback={foregroundFallback}
          onChange={setForegroundColor}
        />
      </SettingRow>

      <SettingRow label={t("appearance.customization.uiFont")}>
        <div className="flex items-center gap-2">
          <SettingsSelect
            value={state.uiFontFamily}
            onValueChange={state.setUiFontFamily}
            options={UI_FONT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(`appearance.customization.fonts.${option.labelKey}`),
            }))}
          />
          <SettingsSelect
            value={state.uiFontWeight}
            onValueChange={state.setUiFontWeight}
            options={FONT_WEIGHT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(`appearance.customization.weights.${option.labelKey}`),
            }))}
          />
        </div>
      </SettingRow>

      <SettingRow label={t("appearance.customization.codeFont")}>
        <div className="flex items-center gap-2">
          <SettingsSelect
            value={state.codeFontFamily}
            onValueChange={state.setCodeFontFamily}
            options={CODE_FONT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(`appearance.customization.fonts.${option.labelKey}`),
            }))}
          />
          <SettingsSelect
            value={state.codeFontWeight}
            onValueChange={state.setCodeFontWeight}
            options={FONT_WEIGHT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(`appearance.customization.weights.${option.labelKey}`),
            }))}
          />
        </div>
      </SettingRow>

      <SettingRow
        label={t("appearance.customization.sidebarTransparency")}
        description={t("appearance.customization.sidebarTransparencyDesc")}
      >
        <Switch
          checked={state.sidebarTransparency}
          onCheckedChange={state.setSidebarTransparency}
        />
      </SettingRow>

      <SettingRow label={t("appearance.customization.contrast")}>
        <div className="flex w-48 items-center gap-3">
          <Slider
            value={[state.contrast]}
            min={0}
            max={100}
            step={1}
            aria-label={t("appearance.customization.contrast")}
            onValueChange={(values) => state.setContrast(values[0] ?? state.contrast)}
          />
          <span className="w-7 shrink-0 text-end text-sm tabular-nums text-muted-foreground">
            {state.contrast}
          </span>
        </div>
      </SettingRow>

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("appearance.customization.reset")}
        </Button>
      </div>
    </SettingsSection>
  );
});
