import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { assertGrPublicationCampaign, type GrPublicationCampaign } from "@reliverse/gr";

import { assertGrPublicationRetainedPrefix } from "./owner-publication";

const campaign: GrPublicationCampaign = {
  id: "fixture-publication",
  paths: ["implementation"],
  commits: [{ id: "source", title: "fixture source", paths: ["implementation"] }],
};

test("campaign scope is explicit policy data, not a builtin campaign or global docs ban", () => {
  expect(() => assertGrPublicationCampaign(campaign)).not.toThrow();
  const docs = {
    id: "fixture-docs",
    paths: ["docs"],
    commits: [{ id: "docs", title: "reviewed docs", paths: ["docs"] }],
  };
  expect(() => assertGrPublicationCampaign(docs)).not.toThrow();
  for (const invalid of [
    { ...campaign, id: "" },
    { ...campaign, paths: [] },
    { ...campaign, paths: ["../escape"] },
    { ...campaign, paths: [".private"] },
    { ...campaign, commits: [{ id: "foreign", title: "foreign", paths: ["outside"] }] },
    { ...campaign, commits: [...campaign.commits, ...campaign.commits] },
  ])
    expect(() => assertGrPublicationCampaign(invalid)).toThrow();
});
test("retained prefix binds the admitted first commit spec, with object integrity checked by core", () => {
  const prefix = {
    commitId: "source",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    title: "fixture source",
    contentBase64: "",
  };
  expect(() => assertGrPublicationRetainedPrefix(prefix, campaign)).not.toThrow();
  for (const field of ["commitId", "commit", "tree", "title"] as const)
    expect(() =>
      assertGrPublicationRetainedPrefix({ ...prefix, [field]: "changed" }, campaign),
    ).toThrow();
  expect(() =>
    assertGrPublicationRetainedPrefix({ ...prefix, contentBase64: "x".repeat(87385) }, campaign),
  ).toThrow();
});
test("publication source ships in npm and must not contain campaign identities or literal operational Git/Gate IDs", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(pkg.files).toContain("src");
  for (const file of [
    "./owner-publication.ts",
    "./owner-retirement.ts",
    "./cmds/campaign/plan/cmd.ts",
    "./rempts/generated-profile.mjs",
    "../../../../packages/gr-core/src/campaign-publication.ts",
    "../../../../packages/gr-action-runtime/src/owner-publication-bootstrap.py",
    "../../../../packages/gr-action-runtime/src/owner-auth-bootstrap.py",
    "../../../../packages/gr-action-runtime/src/publication-key-bootstrap.py",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(
      /campaign\d{3}|reliverse-open-sourcing-\d+|gate_[a-f0-9]{32}|["'][a-f0-9]{40}["']|prn_[a-f0-9]{32}|blefnk|@gmail\.com/i,
    );
  }
});
