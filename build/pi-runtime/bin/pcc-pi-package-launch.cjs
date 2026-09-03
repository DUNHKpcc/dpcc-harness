"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CONFIG_ENV_KEY = "PCC_AGENT_PI_PACKAGE_CONFIG";
const HOST_ENV_KEY = "PCC_AGENT_PI_RUNTIME_HOST";
const ENTRY_ENV_KEY = "PCC_AGENT_PI_ENTRY";
const MAX_CONFIG_BYTES = 512 * 1024;
const MAX_RESOURCES = 500;
const RESOURCE_FLAGS = {
  extensions: "--extension",
  skills: "--skill",
  prompts: "--prompt",
  themes: "--theme",
};

function fail(message) {
  process.stderr.write(`PccAgent Pi package launcher: ${message}\n`);
  process.exitCode = 78;
}

function readPackageArguments(configPath) {
  if (!path.isAbsolute(configPath)) {
    throw new Error("package config path must be absolute");
  }
  const stat = fs.statSync(configPath);
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error("package config is unavailable");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config || config.version !== 1 || !config.resources || typeof config.resources !== "object") {
    throw new Error("package config is invalid");
  }

  const args = [];
  const seen = new Set();
  let count = 0;
  for (const [kind, flag] of Object.entries(RESOURCE_FLAGS)) {
    const resources = config.resources[kind];
    if (!Array.isArray(resources)) throw new Error("package config is invalid");
    for (const resourcePath of resources) {
      if (typeof resourcePath !== "string" || !path.isAbsolute(resourcePath)) {
        throw new Error("package resource path is invalid");
      }
      const canonicalPath = fs.realpathSync(resourcePath);
      if (!fs.statSync(canonicalPath).isFile()) {
        throw new Error("package resource is unavailable");
      }
      const key = `${kind}:${canonicalPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
      if (count > MAX_RESOURCES) throw new Error("package resource count exceeds the limit");
      args.push(flag, canonicalPath);
    }
  }
  return args;
}

function main() {
  const host = process.env[HOST_ENV_KEY]?.trim();
  const entry = process.env[ENTRY_ENV_KEY]?.trim();
  const configPath = process.env[CONFIG_ENV_KEY]?.trim();
  if (!host || !entry || !configPath) {
    fail("runtime or package configuration is unavailable");
    return;
  }

  let packageArgs;
  try {
    packageArgs = readPackageArguments(configPath);
  } catch {
    fail("package configuration is invalid or no longer available");
    return;
  }

  process.env.ELECTRON_RUN_AS_NODE = "1";
  const child = spawn(host, [entry, ...process.argv.slice(2), ...packageArgs], {
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  child.once("error", () => fail("the bundled Pi runtime could not be started"));
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

main();
