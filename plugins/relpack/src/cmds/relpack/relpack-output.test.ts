import { describe, expect, test } from "bun:test";

import {
  formatListOutput,
  formatPackOutput,
  formatTestOutput,
  formatUnpackOutput,
} from "./_shared";

describe("relpack human output", () => {
  test("pack preview explains --apply", () => {
    const output = formatPackOutput({
      inputs: ["./package.json", "./turbo.json"],
      output: "dist.tar.zst",
      format: "tar.zst",
      overwrite: false,
      dryRun: true,
      explicitDryRun: false,
      backendCommand: "tar --zstd -cf dist.tar.zst package.json turbo.json",
      ignoredNames: [".git", "node_modules", "dist"],
      includeDefaultIgnores: true,
      extraIgnoredNames: [],
      applyCommand: "rse relpack pack ./package.json ./turbo.json -o dist.tar.zst --apply",
      overwriteApplyCommand:
        "rse relpack pack ./package.json ./turbo.json -o dist.tar.zst --overwrite --apply",
    });

    expect(output).toContain("Relpack pack preview");
    expect(output).toContain("no archive was created because --apply was not passed");
    expect(output).toContain("Create the archive: rse relpack pack");
    expect(output).toContain("Default ignore policy");
    expect(output).toContain("node_modules");
    expect(output).toContain("--include-ignored disables");
    expect(output).toContain("--overwrite allows replacing an existing output archive");
  });

  test("unpack preview explains safety and --apply", () => {
    const output = formatUnpackOutput({
      archive: "dist.zip",
      outputDir: "./out",
      format: "zip",
      overwrite: false,
      deleteArchive: false,
      cleanOutput: false,
      dryRun: true,
      explicitDryRun: false,
      backendCommand: "unzip -n -q dist.zip -d ./out",
      applyCommand: "rse relpack unpack dist.zip -o ./out --apply",
      overwriteApplyCommand: "rse relpack unpack dist.zip -o ./out --overwrite --apply",
    });

    expect(output).toContain("Relpack unpack preview");
    expect(output).toContain("Archive entry paths are validated before extraction");
    expect(output).toContain("Extract files: rse relpack unpack dist.zip -o ./out --apply");
    expect(output).toContain("--delete-archive deletes the source archive only after extraction succeeds");
  });

  test("unpack preview explains delete archive", () => {
    const output = formatUnpackOutput({
      archive: "relpack-0.0.7.zip",
      outputDir: "./plugins/relpack",
      format: "zip",
      overwrite: true,
      deleteArchive: true,
      cleanOutput: false,
      dryRun: true,
      explicitDryRun: false,
      backendCommand: "unzip -o -q relpack-0.0.7.zip -d ./plugins/relpack",
      applyCommand:
        "rse relpack unpack relpack-0.0.7.zip -o ./plugins/relpack --overwrite --delete-archive --apply",
      overwriteApplyCommand:
        "rse relpack unpack relpack-0.0.7.zip -o ./plugins/relpack --overwrite --delete-archive --apply",
    });

    expect(output).toContain("delete source archive: after successful extraction");
    expect(output).toContain(
      "When you add --apply, the source archive will be deleted only after extraction succeeds.",
    );
  });

  test("unpack success reports deleted archive", () => {
    const output = formatUnpackOutput({
      archive: "relpack-0.0.7.zip",
      outputDir: "./plugins/relpack",
      format: "zip",
      overwrite: true,
      deleteArchive: true,
      cleanOutput: false,
      deletedArchivePath: "/repo/relpack-0.0.7.zip",
      dryRun: false,
      explicitDryRun: false,
      backendCommand: "unzip -o -q relpack-0.0.7.zip -d ./plugins/relpack",
      applyCommand:
        "rse relpack unpack relpack-0.0.7.zip -o ./plugins/relpack --overwrite --delete-archive --apply",
      overwriteApplyCommand:
        "rse relpack unpack relpack-0.0.7.zip -o ./plugins/relpack --overwrite --delete-archive --apply",
    });

    expect(output).toContain("archive extracted; source archive deleted");
    expect(output).toContain("Source archive deleted: /repo/relpack-0.0.7.zip");
  });

  test("unpack preview explains clean output", () => {
    const output = formatUnpackOutput({
      archive: "relpack-0.0.8.zip",
      outputDir: "./plugins/relpack",
      format: "zip",
      overwrite: true,
      deleteArchive: false,
      cleanOutput: true,
      dryRun: true,
      explicitDryRun: false,
      backendCommand: "unzip -o -q relpack-0.0.8.zip -d ./plugins/relpack",
      applyCommand:
        "rse relpack unpack relpack-0.0.8.zip -o ./plugins/relpack --overwrite --clean-output --apply",
      overwriteApplyCommand:
        "rse relpack unpack relpack-0.0.8.zip -o ./plugins/relpack --overwrite --clean-output --apply",
    });

    expect(output).toContain("clean output directory: before extraction");
    expect(output).toContain(
      "When you add --apply, the output directory will be deleted first, then recreated for extraction.",
    );
    expect(output).toContain("--clean-output deletes the explicit -o/--output directory before extraction");
  });

  test("list output has next steps", () => {
    const output = formatListOutput({
      archive: "dist.zip",
      format: "zip",
      entries: [{ path: "package.json", kind: "unknown" }],
    });

    expect(output).toContain("Relpack list");
    expect(output).toContain("1 entry found");
    expect(output).toContain("Preview extraction: rse relpack unpack dist.zip -o ./out");
  });

  test("test output has backend command and next steps", () => {
    const output = formatTestOutput({
      archive: "dist.tar.zst",
      format: "tar.zst",
      backendCommand: "tar -tf dist.tar.zst",
    });

    expect(output).toContain("Relpack test");
    expect(output).toContain("archive is readable");
    expect(output).toContain("tar -tf dist.tar.zst");
  });
});
