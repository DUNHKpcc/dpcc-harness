import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutSettings } from "../AboutSettings";
import packageJson from "../../../../package.json";
import enSettings from "../../../i18n/locales/en/settings.json";
import zhSettings from "../../../i18n/locales/zh/settings.json";
import {
  INITIAL_RELEASE_HISTORY_LIMIT,
  RELEASE_HISTORY,
  releaseTranslationKey,
} from "../../../lib/release-history";

describe("AboutSettings", () => {
  it("uses a relative app icon path so packaged file:// builds can load it", () => {
    const html = renderToStaticMarkup(<AboutSettings />);

    expect(html).toContain('alt="PccAgent"');
    expect(html).toContain('src="icon.png"');
    expect(html).not.toContain('src="/icon.png"');
  });

  it("renders an accessible bundled release history without a runtime network request", () => {
    const html = renderToStaticMarkup(<AboutSettings />);

    expect(INITIAL_RELEASE_HISTORY_LIMIT).toBe(3);
    expect(html).toContain("Release history");
    expect(html).toContain("v2.1.5");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("release-details-v2_1_5");
    expect(html).toContain("Show older releases");
  });

  it("keeps every tagged app version ordered, unique, and localized", () => {
    const versions = RELEASE_HISTORY.map((release) => release.version);
    const toParts = (version: string) => version.split(".").map(Number);

    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(packageJson.version);
    expect(versions).toEqual([
      "2.1.6", "2.1.5", "2.1.4", "2.1.3", "2.1.2", "2.1.1", "2.1.0", "2.0.9",
      "2.0.8", "2.0.7", "2.0.6", "2.0.5", "2.0.4", "2.0.3",
      "2.0.2", "2.0.1", "2.0.0", "1.0.2", "1.0.1", "1.0.0",
    ]);

    for (let index = 0; index < RELEASE_HISTORY.length; index += 1) {
      const release = RELEASE_HISTORY[index];
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Number.isNaN(Date.parse(`${release.date}T00:00:00Z`))).toBe(false);
      if (index > 0) {
        const previous = toParts(RELEASE_HISTORY[index - 1].version);
        const current = toParts(release.version);
        expect(previous[0] * 1_000_000 + previous[1] * 1_000 + previous[2])
          .toBeGreaterThan(current[0] * 1_000_000 + current[1] * 1_000 + current[2]);
      }

      const key = releaseTranslationKey(release.version) as keyof typeof enSettings.about.releaseHistory.entries;
      const enEntry = enSettings.about.releaseHistory.entries[key];
      const zhEntry = zhSettings.about.releaseHistory.entries[key];
      expect(enEntry?.title).toBeTruthy();
      expect(zhEntry?.title).toBeTruthy();
      for (const changeKey of release.changeKeys) {
        expect(enEntry?.[changeKey as keyof typeof enEntry]).toBeTruthy();
        expect(zhEntry?.[changeKey as keyof typeof zhEntry]).toBeTruthy();
      }
    }
  });
});
