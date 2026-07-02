import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCodexUpstream,
} = vi.hoisted(() => ({
  mockResolveCodexUpstream: vi.fn(),
}));

vi.mock("../upstream-resolver", () => ({
  resolveCodexUpstream: mockResolveCodexUpstream,
}));

async function loadModule() {
  vi.resetModules();
  return import("../codex-upstream");
}

describe("codexUpstreamThreadParams", () => {
  beforeEach(() => {
    mockResolveCodexUpstream.mockReset();
  });

  it("uses the selected model fallback when non-local upstream config has no model", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "default",
      providerName: "DPCC API",
      baseUrl: "https://api.dpcc.example/v1",
      apiKey: "sk-dpcc",
      model: "",
    });
    const { codexUpstreamThreadParams } = await loadModule();

    expect(codexUpstreamThreadParams("dpcc-default-model")).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      model: "dpcc-default-model",
      config: expect.objectContaining({
        model_provider: "pcc-agent-gateway",
        model: "dpcc-default-model",
      }),
    });
  });

  it("omits model instead of passing null when neither config nor fallback provides one", async () => {
    mockResolveCodexUpstream.mockReturnValue({
      tier: "gateway",
      providerName: "Gateway Provider",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-gateway",
      model: "",
    });
    const { codexUpstreamThreadParams } = await loadModule();

    const params = codexUpstreamThreadParams();

    expect(params).toMatchObject({
      modelProvider: "pcc-agent-gateway",
      config: expect.objectContaining({
        model_provider: "pcc-agent-gateway",
      }),
    });
    expect(params).not.toHaveProperty("model");
    expect(params.config).not.toHaveProperty("model");
  });
});
