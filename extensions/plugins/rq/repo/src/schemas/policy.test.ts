import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { RepoRqSchemasConfig } from "../config";
import { inspectSchemasPolicy } from "./policy";

const temporaryDirectories: string[] = [];

const config: RepoRqSchemasConfig = Object.freeze({
  adoptionMode: "enforced",
  constantNameTokens: Object.freeze([
    "API",
    "CONTRACT",
    "FORMAT",
    "MANIFEST",
    "PROTOCOL",
    "SCHEMA",
  ]),
  ignore: Object.freeze([]),
  numericFieldNames: Object.freeze(["apiVersion", "protocolVersion", "schemaVersion"]),
  numericGenerationSeverity: "error",
  ownedFormatNameTokens: Object.freeze(["document", "receipt", "ticket"]),
  ownedFormatGenerationSeverity: "error",
  ownedNamespaces: Object.freeze(["reliverse", "rse", "rvs"]),
  roots: Object.freeze(["src"]),
  versionedFilenameSeverity: "warning",
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rq-schemas-"));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    '{"name":"fixture","private":true,"version":"0.0.0","workspaces":["src/*"]}\n',
    "utf8",
  );
  await Promise.all(
    Object.entries(files).map(async ([name, source]) => {
      const target = join(directory, name);
      await Bun.$`mkdir -p ${dirname(target)}`.quiet();
      await writeFile(target, source, "utf8");
    }),
  );
  return directory;
}

describe("repo.schemas policy", () => {
  test("accepts v0 owned contracts and external API v1 URLs", async () => {
    const root = await fixture({
      "src/contract.ts": `export const receipt = { schemaVersion: 0, format: "rse.receipt/v0", endpoint: "https://api.openai.com/v1" };\n`,
    });

    const report = await inspectSchemasPolicy(root, config);
    expect(report.findings).toEqual([]);
  });

  test("finds numeric and owned string generations", async () => {
    const root = await fixture({
      "src/contract.ts": `export const receipt = { schemaVersion: 1, format: "reliverse.receipt.v2", ticket: "rvs-host-command-ticket-v3" };\n`,
    });

    const report = await inspectSchemasPolicy(root, config);
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([
      "repo.schemas.numeric-generation",
      "repo.schemas.owned-format-generation",
    ]);
  });

  test("finds generation-versioned source filenames", async () => {
    const root = await fixture({ "src/target-v1.ts": "export {};\n" });
    const report = await inspectSchemasPolicy(root, config);
    expect(report.findings[0]?.ruleId).toBe("repo.schemas.versioned-contract-filename");
  });

  test("keeps synthetic tests and fixtures outside the release gate", async () => {
    const root = await fixture({
      "src/contract.test.ts":
        'export const fixture = { schemaVersion: 2, format: "reliverse.receipt.v3" };\n',
      "src/tests/fixture-v2.ts": "export const fixture = { protocolVersion: 4 };\n",
    });
    const report = await inspectSchemasPolicy(root, config);
    expect(report.findings).toEqual([]);
  });
});
