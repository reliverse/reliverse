import { describe, expect, test } from "bun:test";

import {
  clearMyEnvCache,
  detectColorSupport,
  detectExecutionContext,
  detectPlatform,
  detectRuntime,
  detectTerminalSupport,
  getEnvHints,
  getMyEnv,
  hasProcess,
  isCI,
  isTTY,
} from "./index";

describe("@reliverse/myenv", () => {
  test("detects bun via process.versions.bun", () => {
    expect(detectRuntime({ process: { versions: { bun: "1.3.0" } } })).toBe("bun");
  });

  test("detects node conservatively", () => {
    expect(detectRuntime({ process: { versions: { node: "24.0.0" } } })).toBe("node");
  });

  test("detects deno conservatively", () => {
    expect(detectRuntime({ deno: { version: { deno: "2.0.0" } }, process: undefined })).toBe("deno");
  });

  test("detects browser main thread conservatively", () => {
    const options = { browserDocument: {}, browserWindow: {} };
    expect(detectRuntime(options)).toBe("browser");
    expect(detectExecutionContext(options)).toBe("browser-main");
    expect(detectPlatform(options)).toBe("browser");
  });

  test("detects worker context conservatively", () => {
    const options = { workerGlobalScope: {} };
    expect(detectRuntime(options)).toBe("worker");
    expect(detectExecutionContext(options)).toBe("web-worker");
    expect(detectPlatform(options)).toBe("browser");
  });

  test("returns unknown when runtime is ambiguous", () => {
    const options = {
      browserDocument: undefined,
      browserWindow: undefined,
      deno: undefined,
      process: undefined,
      workerGlobalScope: undefined,
    };

    expect(detectRuntime(options)).toBe("unknown");
    expect(detectExecutionContext(options)).toBe("unknown");
  });

  test("detects platform from process and deno safely", () => {
    expect(detectPlatform({ process: { platform: "darwin" } })).toBe("darwin");
    expect(detectPlatform({ deno: { build: { os: "linux" } } })).toBe("linux");
    expect(detectPlatform({ process: { platform: "mystery-os" } })).toBe("unknown");
  });

  test("handles process absence safely", () => {
    expect(hasProcess({ process: undefined, env: {} })).toBe(false);
    expect(getEnvHints({ process: undefined, env: {} }).hasProcess).toBe(false);
  });

  test("reports tty and stream-specific native color levels", () => {
    const options = {
      stdout: { getColorDepth: () => 24, isTTY: true },
      stderr: { getColorDepth: () => 8, isTTY: true },
    };

    expect(isTTY("stdout", options)).toBe(true);
    expect(isTTY("stderr", options)).toBe(true);
    expect(detectColorSupport("stdout", options)).toBe(3);
    expect(detectColorSupport("stderr", options)).toBe(2);
    expect(detectTerminalSupport(options)).toEqual({
      stderr: { isTTY: true, level: 2 },
      stdout: { isTTY: true, level: 3 },
    });
  });

  test("returns predictable tty fallback when stream information is missing", () => {
    expect(isTTY("stdout", { stdout: undefined })).toBe(false);
    expect(detectColorSupport("stdout", { stdout: undefined, env: {} })).toBe(0);
  });

  test("respects explicit color override over flags and env", () => {
    expect(
      detectColorSupport("stdout", {
        argv: ["--no-color"],
        env: { FORCE_COLOR: "0", NO_COLOR: "1" },
        explicitColor: 3,
        stdout: { isTTY: false },
      }),
    ).toBe(3);
  });

  test("respects cli color flags before env", () => {
    expect(detectColorSupport("stdout", { argv: ["--no-color"], env: { FORCE_COLOR: "3" } })).toBe(0);
    expect(detectColorSupport("stdout", { argv: ["--color=256"], env: { NO_COLOR: "1" } })).toBe(2);
    expect(detectColorSupport("stdout", { argv: ["--color=truecolor"] })).toBe(3);
    expect(detectColorSupport("stdout", { argv: ["--color"] })).toBe(1);
  });

  test("respects env color precedence before native fallback", () => {
    expect(detectColorSupport("stdout", { env: { FORCE_COLOR: "2", NO_COLOR: "1" } })).toBe(2);
    expect(detectColorSupport("stdout", { env: { NO_COLOR: "1" } })).toBe(0);
    expect(detectColorSupport("stdout", { env: { NODE_DISABLE_COLORS: "1" }, stdout: { isTTY: true } })).toBe(0);
  });

  test("falls back conservatively to basic color in ci when nothing better is known", () => {
    expect(detectColorSupport("stdout", { env: { CI: "true" }, stdout: undefined })).toBe(1);
  });

  test("detects ci hints conservatively", () => {
    expect(isCI({ env: { CI: "true" } })).toBe(true);
    expect(isCI({ env: { GITHUB_ACTIONS: "true" } })).toBe(true);
    expect(getEnvHints({ argv: ["--color=256"], env: { CI: "true", FORCE_COLOR: "1", NO_COLOR: "" }, process: undefined })).toEqual({
      ci: true,
      colorFlag: "256",
      forceColor: "1",
      hasProcess: false,
      noColor: true,
      nodeDisableColors: false,
    });
  });

  test("memoizes only default snapshot and can clear cache", () => {
    clearMyEnvCache();
    const first = getMyEnv();
    const second = getMyEnv();
    expect(first).toBe(second);
    clearMyEnvCache();
    const third = getMyEnv();
    expect(third).not.toBe(first);
  });

  test("does not cache explicit snapshots", () => {
    const first = getMyEnv({ env: { CI: "true" } });
    const second = getMyEnv({ env: { CI: "true" } });
    expect(first).not.toBe(second);
    expect(first.hints.ci).toBe(true);
  });
});
