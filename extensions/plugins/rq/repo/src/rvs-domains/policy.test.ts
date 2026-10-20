import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectRvsDomainPolicy } from "./policy";
import { REPO_RVS_DOMAIN_RULE_IDS } from "./rules";

async function write(root: string, relative: string, value: unknown): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

test("rejects concrete core dependencies from manifests and source imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rvs-domains-core-"));
  try {
    await write(root, "package.json", { private: true, workspaces: ["packages/rvs/*"] });
    await write(root, "packages/rvs/rvs-core/package.json", {
      name: "@reliverse/rvs",
      dependencies: { "@reliverse/rvs-provider-hcloud": "workspace:*" },
    });
    await write(
      root,
      "packages/rvs/rvs-core/src/index.ts",
      'import "@reliverse/rvs-systemd-ubuntu";\n',
    );
    for (const [directory, name] of [
      ["rvs-control", "@reliverse/rvs-control"],
      ["rvs-deployment", "@reliverse/rvs-deployment"],
      ["rvs-host", "@reliverse/rvs-host"],
      ["rvs-network", "@reliverse/rvs-network"],
      ["rvs-private", "@reliverse/rvs-private"],
      ["rvs-reconcile", "@reliverse/rvs-reconcile"],
    ]) {
      await write(root, `packages/rvs/${directory}/package.json`, { name });
    }

    const report = await inspectRvsDomainPolicy(root);
    const finding = report.findings.find(
      (entry) => entry.ruleId === REPO_RVS_DOMAIN_RULE_IDS.coreConcreteDependency,
    );
    expect(finding?.message).toContain("@reliverse/rvs-provider-hcloud");
    expect(finding?.message).toContain("@reliverse/rvs-systemd-ubuntu");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires each materialized canonical RVS owner at its exact path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rvs-domains-owner-"));
  try {
    await write(root, "package.json", { private: true, workspaces: ["packages/rvs/*"] });
    await write(root, "packages/rvs/rvs-core/package.json", { name: "@reliverse/rvs" });
    await write(root, "packages/rvs/rvs-control/package.json", { name: "@reliverse/rvs-control" });
    await write(root, "packages/rvs/rvs-deployment/package.json", {
      name: "@reliverse/rvs-deployment",
    });
    await write(root, "packages/rvs/rvs-host/package.json", { name: "@reliverse/not-rvs-host" });
    await write(root, "packages/rvs/rvs-network/package.json", { name: "@reliverse/rvs-network" });
    await write(root, "packages/rvs/rvs-private/package.json", { name: "@reliverse/rvs-private" });
    await write(root, "packages/rvs/rvs-reconcile/package.json", {
      name: "@reliverse/rvs-reconcile",
    });

    const report = await inspectRvsDomainPolicy(root);
    expect(
      report.findings.some(
        (entry) =>
          entry.ruleId === REPO_RVS_DOMAIN_RULE_IDS.canonicalOwner &&
          entry.path === "packages/rvs/rvs-host/package.json",
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects manifest and source consumers of retired RVS packages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rvs-domains-host-wrapper-"));
  try {
    await write(root, "package.json", {
      private: true,
      workspaces: ["packages/*", "packages/rvs/*"],
    });
    for (const [directory, name] of [
      ["rvs-control", "@reliverse/rvs-control"],
      ["rvs-deployment", "@reliverse/rvs-deployment"],
      ["rvs-core", "@reliverse/rvs"],
      ["rvs-host", "@reliverse/rvs-host"],
      ["rvs-network", "@reliverse/rvs-network"],
      ["rvs-private", "@reliverse/rvs-private"],
      ["rvs-reconcile", "@reliverse/rvs-reconcile"],
    ]) {
      await write(root, `packages/rvs/${directory}/package.json`, { name });
    }
    await write(root, "packages/new-consumer/package.json", {
      name: "@example/new-rvs-consumer",
      dependencies: { "@reliverse/rvs-host-protocol": "workspace:*" },
      devDependencies: { "@reliverse/rvs-host-software": "workspace:*" },
    });
    await write(
      root,
      "packages/new-consumer/src/index.ts",
      'import "@reliverse/rvs-host-trust";\n',
    );

    const report = await inspectRvsDomainPolicy(root);
    const finding = report.findings.find(
      (entry) => entry.ruleId === REPO_RVS_DOMAIN_RULE_IDS.retiredPackageConsumer,
    );
    expect(finding?.message).toContain("@reliverse/rvs-host-protocol");
    expect(finding?.message).toContain("@reliverse/rvs-host-trust");
    expect(finding?.message).toContain("@reliverse/rvs-host-software");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
