import { describe, expect, it } from "vitest";
import {
  buildConfigSourcePatch,
  shouldApplyConfigSourceRefresh,
} from "../current-config-settings-utils";
import { resolveGatewayConfigSource } from "@shared/lib/upstream-routing";

describe("current config settings utilities", () => {
  it("ignores stale config source refreshes from older requests", () => {
    expect(shouldApplyConfigSourceRefresh(2, 2)).toBe(true);
    expect(shouldApplyConfigSourceRefresh(1, 2)).toBe(false);
  });

  it("builds an engine-scoped settings patch for Pi config source changes", () => {
    expect(buildConfigSourcePatch("pi", "gateway")).toEqual({
      piCliConfigSource: "gateway",
    });
  });

  it("routes only enabled, credentialed third-party gateways through the gateway source", () => {
    expect(resolveGatewayConfigSource({
      enabled: true,
      baseUrl: "https://third-party.example/v1",
      credential: "sk-third-party",
    })).toBe("gateway");

    expect(resolveGatewayConfigSource({
      enabled: true,
      baseUrl: "https://api.dpccgaming.xyz/v1",
      credential: "sk-dpcc",
    })).toBe("default");

    expect(resolveGatewayConfigSource({
      enabled: false,
      baseUrl: "https://third-party.example/v1",
      credential: "sk-third-party",
    })).toBe("default");
  });
});
