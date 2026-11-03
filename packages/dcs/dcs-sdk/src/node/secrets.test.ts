import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDcsSecretProviderRegistry,
  dcsSecret,
  resolveDcsSecretReference,
  revealDcsSecretValue,
} from "../index";
import {
  createDcsEnvironmentSecretProvider,
  createDcsFileSecretProvider,
  createDcsKeychainSecretProvider,
} from "./index";

test("explicit env, file, and injected keychain providers honor allowlists", async () => {
  const root = await mkdtemp(join(tmpdir(), "dcs-secrets-"));
  try {
    await writeFile(join(root, "token.txt"), "from-file\n", "utf8");
    const registry = createDcsSecretProviderRegistry([
      createDcsEnvironmentSecretProvider({
        allowKeys: ["DCS_TEST_TOKEN"],
        environment: { DCS_TEST_TOKEN: "from-env" },
      }),
      createDcsFileSecretProvider({ allowKeys: ["token.txt"], rootDirectory: root }),
      createDcsKeychainSecretProvider({
        allowKeys: ["service-token"],
        lookup: (key) => (key === "service-token" ? "from-keychain" : undefined),
      }),
    ]);

    const env = await resolveDcsSecretReference({
      reference: dcsSecret("env", "DCS_TEST_TOKEN"),
      registry,
    });
    const file = await resolveDcsSecretReference({
      reference: dcsSecret("file", "token.txt"),
      registry,
    });
    const keychain = await resolveDcsSecretReference({
      reference: dcsSecret("keychain", "service-token"),
      registry,
    });
    const denied = await resolveDcsSecretReference({
      reference: dcsSecret("env", "OTHER_TOKEN"),
      registry,
    });

    expect(env.state === "resolved" ? revealDcsSecretValue(env.value) : undefined).toBe("from-env");
    expect(file.state === "resolved" ? revealDcsSecretValue(file.value) : undefined).toBe(
      "from-file",
    );
    expect(keychain.state === "resolved" ? revealDcsSecretValue(keychain.value) : undefined).toBe(
      "from-keychain",
    );
    expect(denied).toEqual({ provider: "env", state: "denied" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
