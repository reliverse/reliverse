import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { c, defineConfig } from "./index";
import { explainConfig, locateConfig, resolveConfig, validateConfig } from "./node";

const config = defineConfig({
  fileStem: "demo-tool",
  id: "org.reliverse.demo-tool",
  root: c.object({
    editor: c
      .object({
        fontSize: c.number().default(14),
        theme: c.enum(["dark", "light"] as const).default("dark"),
      })
      .merge("deep"),
    plugins: c.array(c.string()).default([]),
    telemetry: c.boolean().default(false).scopes(["user", "workspace", "invocation"]),
  }),
});

test("canonical discovery resolves user, workspace, local, and invocation sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-discovery-"));
  const workspaceRoot = path.join(root, "workspace");
  const xdgRoot = path.join(root, "xdg");

  try {
    await mkdir(path.join(xdgRoot, "demo-tool"), { recursive: true });
    await mkdir(path.join(workspaceRoot, ".demo-tool"), { recursive: true });

    await writeFile(
      path.join(xdgRoot, "demo-tool", "config.json"),
      JSON.stringify({ editor: { theme: "light" }, plugins: ["user"] }),
    );
    await writeFile(
      path.join(workspaceRoot, "demo-tool.config.json"),
      JSON.stringify({ editor: { fontSize: 16 }, plugins: ["workspace"], telemetry: true }),
    );
    await writeFile(
      path.join(workspaceRoot, ".demo-tool", "config.local.json"),
      JSON.stringify({ $dcs: { resets: ["/editor/fontSize"] }, plugins: ["local"] }),
    );

    const result = await resolveConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: xdgRoot },
      homeDir: path.join(root, "home"),
      invocation: { telemetry: false },
      platform: "linux",
      workspaceRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.discovery.documents.map((entry) => entry.layer.scope)).toEqual([
      "user",
      "workspace",
      "local",
    ]);
    expect(result.resolved?.value).toEqual({
      editor: { fontSize: 14, theme: "light" },
      plugins: ["local"],
      telemetry: false,
    });
    expect(result.resolved?.provenance["/editor/fontSize"]?.resets).toEqual([
      {
        kind: "local-document",
        location: path.join(workspaceRoot, ".demo-tool", "config.local.json"),
      },
    ]);

    const explanation = await explainConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: xdgRoot },
      homeDir: path.join(root, "home"),
      path: "/plugins",
      platform: "linux",
      workspaceRoot,
    });
    expect(explanation.explanation?.effectiveSource).toEqual({
      kind: "local-document",
      location: path.join(workspaceRoot, ".demo-tool", "config.local.json"),
    });

    const validation = await validateConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: xdgRoot },
      homeDir: path.join(root, "home"),
      platform: "linux",
      workspaceRoot,
    });
    expect(validation.ok).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("locateConfig follows the explicit platform profiles", () => {
  expect(
    locateConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: "/portable/xdg" },
      homeDir: "/home/demo",
      platform: "linux",
      workspaceRoot: "/repo/demo",
    }),
  ).toEqual({
    local: "/repo/demo/.demo-tool/config.local.json",
    user: "/portable/xdg/demo-tool/config.json",
    workspace: "/repo/demo/demo-tool.config.json",
  });

  expect(
    locateConfig({
      bundle: config.bundle,
      homeDir: "/Users/demo",
      platform: "darwin",
      workspaceRoot: "/repo/demo",
    }),
  ).toEqual({
    local: "/repo/demo/.demo-tool/config.local.json",
    user: "/Users/demo/Library/Application Support/demo-tool/config.json",
    workspace: "/repo/demo/demo-tool.config.json",
  });

  expect(
    locateConfig({
      bundle: config.bundle,
      env: { APPDATA: "D:\\AppData" },
      homeDir: "C:\\Users\\demo",
      platform: "win32",
      workspaceRoot: "C:\\repo\\demo",
    }),
  ).toEqual({
    local: "C:\\repo\\demo\\.demo-tool\\config.local.json",
    user: "D:\\AppData\\demo-tool\\config.json",
    workspace: "C:\\repo\\demo\\demo-tool.config.json",
  });
});

test("discovery selects a lone JSONC document and effective revision ignores comments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-discovery-jsonc-"));
  try {
    const source = `{
  // this comment should not affect effective runtime state
  "editor": {
    "theme": "light",
  },
}
`;
    await writeFile(path.join(root, "demo-tool.config.jsonc"), source);

    const first = await resolveConfig({
      bundle: config.bundle,
      includeUser: false,
      includeLocal: false,
      workspaceRoot: root,
    });
    expect(first.ok).toBe(true);
    expect(first.discovery.documents[0]?.format).toBe("jsonc");
    expect(first.resolved?.value.editor).toEqual({ fontSize: 14, theme: "light" });
    expect(first.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    await writeFile(
      path.join(root, "demo-tool.config.jsonc"),
      source.replace("this comment", "changed comment"),
    );
    const second = await resolveConfig({
      bundle: config.bundle,
      includeUser: false,
      includeLocal: false,
      workspaceRoot: root,
    });
    expect(second.effectiveRevision).toBe(first.effectiveRevision);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("explicit profile discovery uses separate overlays and profile-aware provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-profiles-"));
  const workspaceRoot = path.join(root, "workspace");
  const xdgRoot = path.join(root, "xdg");

  try {
    await mkdir(path.join(xdgRoot, "demo-tool"), { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(xdgRoot, "demo-tool", "config.json"),
      JSON.stringify({ editor: { theme: "light" } }),
    );
    await writeFile(
      path.join(xdgRoot, "demo-tool", "config.production.jsonc"),
      `{
  // production only
  "$dcs": { "profile": "production" },
  "editor": { "fontSize": 18 }
}
`,
    );
    await writeFile(
      path.join(workspaceRoot, "demo-tool.config.json"),
      JSON.stringify({ plugins: ["workspace"], telemetry: true }),
    );
    await writeFile(
      path.join(workspaceRoot, "demo-tool.config.production.json"),
      JSON.stringify({ $dcs: { profile: "production" }, telemetry: false }),
    );

    const base = await resolveConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: xdgRoot },
      homeDir: path.join(root, "home"),
      platform: "linux",
      workspaceRoot,
    });
    expect(base.ok).toBe(true);
    expect(base.resolved?.value).toEqual({
      editor: { fontSize: 14, theme: "light" },
      plugins: ["workspace"],
      telemetry: true,
    });

    const profiled = await resolveConfig({
      bundle: config.bundle,
      env: { XDG_CONFIG_HOME: xdgRoot },
      homeDir: path.join(root, "home"),
      platform: "linux",
      profile: "production",
      workspaceRoot,
    });
    expect(profiled.ok).toBe(true);
    expect(profiled.discovery.profile?.name).toBe("production");
    expect(
      profiled.discovery.documents.map((entry) => [entry.layer.scope, entry.profile ?? "base"]),
    ).toEqual([
      ["user", "base"],
      ["user", "production"],
      ["workspace", "base"],
      ["workspace", "production"],
    ]);
    expect(profiled.resolved?.value).toEqual({
      editor: { fontSize: 18, theme: "light" },
      plugins: ["workspace"],
      telemetry: false,
    });
    expect(profiled.resolved?.provenance["/telemetry"]?.effectiveSource).toEqual({
      kind: "workspace-profile-document",
      location: path.join(workspaceRoot, "demo-tool.config.production.json"),
      profile: "production",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
