import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutSettings } from "./AboutSettings";

describe("AboutSettings", () => {
  it("uses a relative app icon path so packaged file:// builds can load it", () => {
    const html = renderToStaticMarkup(<AboutSettings />);

    expect(html).toContain('alt="PccAgent"');
    expect(html).toContain('src="icon.png"');
    expect(html).not.toContain('src="/icon.png"');
  });
});
