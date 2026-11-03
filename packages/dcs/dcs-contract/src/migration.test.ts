import { expect, test } from "bun:test";

import {
  applyDcsMigrationPlan,
  createConfigContractBundle,
  findDcsMigrationPlan,
  type ConfigContractBundle,
  type DcsMigrationPlan,
} from "./index";

const plan: DcsMigrationPlan = {
  $dcs: {
    format: "dcs-migration-plan",
    from: { contractVersion: 1, documentVersion: 1 },
    id: "org.example.demo-tool",
    to: { contractVersion: 2, documentVersion: 1 },
    version: "0.0.1",
  },
  operations: [{ from: "/server", op: "rename", to: "/network" }],
};

const targetBundle = bundle(2, {
  migrations: [plan],
  networkName: "network",
});

test("declarative rename migrates sparse values, resets, envelope and opaque extensions", () => {
  const result = applyDcsMigrationPlan({
    document: {
      $dcs: {
        contractVersion: 1,
        documentVersion: 1,
        id: "org.example.demo-tool",
        resets: ["/server"],
      },
      $extensions: { "org.example.keep": { enabled: true } },
      server: { host: "10.0.0.1", port: 3000 },
    },
    plan,
  });

  expect(result.document).toEqual({
    $dcs: {
      contractVersion: 2,
      documentVersion: 1,
      id: "org.example.demo-tool",
      resets: ["/network"],
    },
    $extensions: { "org.example.keep": { enabled: true } },
    network: { host: "10.0.0.1", port: 3000 },
  });
  expect(result.pathMap).toEqual({ "/server": "/network" });
  expect(findDcsMigrationPlan(targetBundle, { contractVersion: 1, documentVersion: 1 })).toEqual(
    plan,
  );
});

test("contract validation rejects duplicate source routes", () => {
  expect(() => bundle(2, { migrations: [plan, plan], networkName: "network" })).toThrow("DCS5009");
});

function bundle(
  version: number,
  input: {
    readonly migrations?: readonly DcsMigrationPlan[];
    readonly networkName: "network" | "server";
  },
): ConfigContractBundle {
  const root = input.networkName;
  return createConfigContractBundle({
    $dcs: {
      contractVersion: version,
      documentVersion: 1,
      fileStem: "demo-tool",
      id: "org.example.demo-tool",
      specVersion: "0.0.1",
    },
    defaults: { [root]: { host: version === 1 ? "127.0.0.1" : "0.0.0.0", port: 3000 } },
    fields: {
      [`/${root}`]: {
        merge: "deep",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
      [`/${root}/host`]: {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
      [`/${root}/port`]: {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
    },
    ...(input.migrations === undefined ? {} : { migrations: input.migrations }),
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        [root]: {
          additionalProperties: false,
          properties: { host: { type: "string" }, port: { type: "number" } },
          required: ["host", "port"],
          type: "object",
        },
      },
      required: [root],
      type: "object",
    },
  });
}
