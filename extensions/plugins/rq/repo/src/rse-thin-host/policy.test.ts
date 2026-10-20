import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectRseThinHostPolicy } from "./policy";

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rse-thin-host-"));
  await write(
    root,
    "package.json",
    JSON.stringify({ private: true, workspaces: ["apps/*/*", "packages/*", "packages/*/*"] }),
  );
  await write(
    root,
    "apps/cli/rse/package.json",
    JSON.stringify({
      name: "@reliverse/rse-cli",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
  );
  await write(
    root,
    "packages/rse/rse-gateway/package.json",
    JSON.stringify({ name: "@reliverse/rse-gateway", dependencies: {} }),
  );
  await write(
    root,
    "apps/gateway/rse/package.json",
    JSON.stringify({ name: "@reliverse/rse-gateway-app", dependencies: {} }),
  );
  await write(root, "apps/gateway/rse/src/main.ts", 'import "@reliverse/rse-gateway";\n');
  await write(
    root,
    "apps/cli/rse/src/cli.ts",
    'import { defineCLI } from "@reliverse/rempts/cli";\nawait import("./plugins/loader");\n',
  );
  await write(root, "apps/cli/rse/src/cmds/run/cmd.ts", "export {};\n");
  await write(root, "apps/cli/rse/src/host/options.ts", "export {};\n");
  await write(root, "apps/cli/rse/src/plugins/loader.ts", "export {};\n");
  await write(
    root,
    "apps/cli/rse/src/runtime/bootstrap.ts",
    'import "@reliverse/gateway-http-client";\nensureRseGatewaySupervisor();\n',
  );
  await write(
    root,
    "packages/rse/rse-gateway/src/supervisor.ts",
    "export function ensureRseGatewaySupervisor() {}\n",
  );
  await write(
    root,
    "packages/rse/rse-gateway/src/providers/openai-direct-probe.ts",
    "export function runRseOpenAiDirectProbe() {}\n",
  );
  await write(
    root,
    "packages/rse/rse-gateway/src/recovery-health.ts",
    "export function inspectRseGatewayRecoveryHealth() {}\n",
  );
  await write(
    root,
    "apps/cli/rse/src/doctor/checks.ts",
    'import { inspectRseGatewayRecoveryHealth } from "@reliverse/rse-gateway";\ninspectRseGatewayRecoveryHealth();\n',
  );
  await write(
    root,
    "packages/rse/rse-gateway/src/capability-catalog.ts",
    'getGatewayOperationContractMetadata();\nconst card = { availability: input.binding ? "admitted" : "discovered" };\n',
  );
  await write(
    root,
    "packages/rse/rse-gateway/src/runtime-boundary.ts",
    'const denial = "RSE_CAPABILITY_NOT_ADMITTED";\n',
  );
  await write(
    root,
    "docs/specs/arch/rse-thin-host-capability-composition.md",
    "`@reliverse/rse-cli` is a Rempts-based product host\nA package name or\nnaming glob MUST NOT be the machine authority\ndeletion-first\n`llm=false` / `inference=forbidden` is a normal Rse operating mode\navailable != installed != compatible != admitted != enabled != loaded != authorized\n",
  );
  return root;
}

test("repo.rse-thin-host accepts a source-validated host without operational inventory", async () => {
  const root = await fixture();
  try {
    expect((await inspectRseThinHostPolicy(root)).findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects a restored hardcoded Gateway capability catalog", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "packages/rse/rse-gateway/src/runtime-boundary.ts",
      "function createRuntimeCapabilityCards() { return []; }\n",
    );
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.sot" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects a restored CLI-owned Gateway client kernel", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "apps/cli/rse/src/runtime/gateway-client.ts",
      "export function createRseCliGatewayClient() {}\n",
    );
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.sot" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects restored app-local config projection", async () => {
  const root = await fixture();
  try {
    await write(root, "apps/cli/rse/src/config/runtime.ts", "export const configRuntime = {};\n");
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.sot" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects direct Gateway recovery storage scans in Doctor", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "apps/cli/rse/src/doctor/checks.ts",
      'import { readFile } from "node:fs/promises";\nreadFile("snapshot.json");\n',
    );
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.sot" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects runtime Doctor source-layout migration checks", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "apps/cli/rse/src/doctor/checks.ts",
      'const id = "rse/tui/legacy-provider-probe";\n',
    );
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.sot" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects inference SDK ownership in the core host", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "packages/rse/rse-gateway/package.json",
      JSON.stringify({
        name: "@reliverse/rse-gateway",
        dependencies: { "@reliverse/rse-ai-sdk-bridge": "workspace:*" },
      }),
    );
    const findings = (await inspectRseThinHostPolicy(root)).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rse-thin-host.zero-intelligence-core" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects transitive optional intelligence bytes with a dependency path", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "packages/rse/rse-gateway/package.json",
      JSON.stringify({
        name: "@reliverse/rse-gateway",
        dependencies: { "@reliverse/engine-wrapper": "workspace:*" },
      }),
    );
    await write(
      root,
      "packages/engine-wrapper/package.json",
      JSON.stringify({
        name: "@reliverse/engine-wrapper",
        optionalDependencies: { "@reliverse/codex-rse-plugin": "workspace:*" },
      }),
    );
    await write(
      root,
      "packages/codex-rse-plugin/package.json",
      JSON.stringify({ name: "@reliverse/codex-rse-plugin" }),
    );
    const findings = (await inspectRseThinHostPolicy(root)).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "repo.rse-thin-host.zero-intelligence-core",
        data: {
          dependency: "@reliverse/codex-rse-plugin",
          dependencyPath: [
            "@reliverse/rse-gateway",
            "@reliverse/engine-wrapper",
            "@reliverse/codex-rse-plugin",
          ],
        },
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rse-thin-host rejects provider code imported only through a core dev dependency", async () => {
  const root = await fixture();
  try {
    await write(
      root,
      "apps/gateway/rse/package.json",
      JSON.stringify({
        name: "@reliverse/rse-gateway-app",
        devDependencies: { "@reliverse/codex-rse-plugin": "workspace:*" },
      }),
    );
    await write(
      root,
      "apps/gateway/rse/src/provider.ts",
      'import "@reliverse/codex-rse-plugin/runtime";\n',
    );
    expect((await inspectRseThinHostPolicy(root)).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "repo.rse-thin-host.zero-intelligence-core",
        path: "apps/gateway/rse/src/provider.ts",
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
