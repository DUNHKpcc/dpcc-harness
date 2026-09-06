import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const doctorScript = path.resolve(process.cwd(), "scripts/check-pi-runtime.mjs");

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "harnss-runtime-doctor-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

interface DoctorResult {
  ok: boolean;
  source: "bundled";
  offlineReady: boolean;
  issues: string[];
  checks: {
    runtimeHost: { ok: boolean; path: string; code?: string };
    launcher: { ok: boolean; path: string; code?: string };
    mcpBridge: { ok: boolean; path: string; code?: string };
    contextBridge: { ok: boolean; path: string; code?: string };
    packageBootstrap: { ok: boolean; path: string; code?: string };
    distribution: { ok: boolean; systemPathPolicy: string };
    catalog: { ok: boolean; code?: string };
    credential: { ok: boolean; code?: string };
    provider: { ok: boolean; code?: string };
    acpInitialize: { ok: boolean; code?: string };
  };
  binaries: Array<{
    binary: string;
    source: "bundled";
    entryPath: string;
    actualVersion: string | null;
    code: string | null;
  }>;
}

function runDoctor(extraEnv: Record<string, string> = {}) {
  const home = createTemporaryDirectory();
  const result = spawnSync(process.execPath, [doctorScript, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: "",
      HOME: home,
      USERPROFILE: home,
      PI_RUNTIME_DOCTOR_TIMEOUT_MS: "3000",
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    value: JSON.parse(result.stdout) as DoctorResult,
  };
}

function providerFixtureEnvironment() {
  const directory = createTemporaryDirectory();
  const catalogPath = path.join(directory, "catalog.json");
  writeFileSync(catalogPath, JSON.stringify({ models: [{ id: "fixture-model" }] }));
  return {
    PI_RUNTIME_DOCTOR_CATALOG: catalogPath,
    PI_RUNTIME_DOCTOR_CREDENTIAL_PRESENT: "true",
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pi runtime doctor", () => {
  it("finds the bundled runtime with an empty PATH while keeping provider failures separate", () => {
    const result = runDoctor();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.value).toMatchObject({
      source: "bundled",
      offlineReady: true,
      checks: {
        runtimeHost: { ok: true },
        launcher: { ok: true },
        mcpBridge: { ok: true },
        contextBridge: { ok: true },
        packageBootstrap: { ok: true },
        distribution: { ok: true, systemPathPolicy: "ignored" },
        acpInitialize: { ok: true },
      },
    });
    expect(result.value.binaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ binary: "pi", source: "bundled", actualVersion: "0.84.1", code: null }),
      expect.objectContaining({ binary: "pi-acp", source: "bundled", actualVersion: "0.0.33", code: null }),
      expect.objectContaining({ binary: "pi-mcp-adapter", source: "bundled", actualVersion: "2.31.0", code: null }),
    ]));
    expect(result.value.issues).toEqual(expect.arrayContaining([
      "catalog_missing",
      "credential_missing",
      "provider_not_configured",
    ]));
  });

  it("passes with the isolated provider fixture and no system commands", () => {
    const result = runDoctor(providerFixtureEnvironment());

    expect(result.status).toBe(0);
    expect(result.value.ok).toBe(true);
    expect(result.value.offlineReady).toBe(true);
    expect(result.value.checks.catalog.ok).toBe(true);
    expect(result.value.checks.credential.ok).toBe(true);
    expect(result.value.checks.provider.ok).toBe(true);
  });

  it("reports provider reachability separately without leaking URL credentials", () => {
    const secret = "doctor-secret-value";
    const result = runDoctor({
      PI_RUNTIME_DOCTOR_CATALOG_URL: `http://127.0.0.1:1/catalog?api_key=${secret}`,
      PI_RUNTIME_DOCTOR_CREDENTIAL_PRESENT: "true",
    });

    expect(result.value.checks.catalog.code).toBe("provider_unreachable");
    expect(result.value.checks.provider.code).toBe("provider_unreachable");
    expect(result.stdout).not.toContain(secret);
  });

  it.skipIf(process.platform === "win32")(
    "ignores a different Pi installation placed first on PATH",
    () => {
      const systemBin = createTemporaryDirectory();
      for (const name of ["pi", "pi-acp"]) {
        const commandPath = path.join(systemBin, name);
        writeFileSync(commandPath, "#!/bin/sh\nprintf '%s\\n' 99.99.99\n");
        chmodSync(commandPath, 0o755);
      }

      const result = runDoctor({
        ...providerFixtureEnvironment(),
        PATH: systemBin,
      });

      expect(result.status).toBe(0);
      expect(result.value.binaries.every((binary) => !binary.entryPath.startsWith(systemBin))).toBe(true);
      expect(result.value.binaries.map((binary) => binary.actualVersion)).toEqual([
        "0.84.1",
        "0.0.33",
        "2.31.0",
      ]);
    },
  );
});
