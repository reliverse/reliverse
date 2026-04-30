import { describe, expect, test } from "bun:test";

import { ParserUsageError } from "./errors";
import { parseArgvTail } from "./parse-argv";

describe("parseArgvTail", () => {
  test("parses boolean negation, explicit boolean values, env, and defaults", async () => {
    const definitions = {
      autoinstall: { type: "boolean", defaultValue: true, inputSources: ["flag", "default"] },
      dryRun: { type: "boolean", defaultValue: false, inputSources: ["flag", "default"] },
      verbose: { type: "boolean", env: "DEMO_VERBOSE", inputSources: ["flag", "env"] },
    } as const;

    await expect(parseArgvTail(["--no-autoinstall"], definitions)).resolves.toMatchObject({
      args: [],
      options: { autoinstall: false, dryRun: false },
    });

    await expect(parseArgvTail(["--autoinstall=false"], definitions)).resolves.toMatchObject({
      options: { autoinstall: false, dryRun: false },
    });

    await expect(
      parseArgvTail(["--dry-run"], definitions, { DEMO_VERBOSE: "yes" }),
    ).resolves.toMatchObject({
      options: { autoinstall: true, dryRun: true, verbose: true },
    });
  });

  test("keeps positional arguments after -- even when they look like options", async () => {
    await expect(
      parseArgvTail(["--", "--not-an-option", "-x"], {
        apply: { type: "boolean" },
      } as const),
    ).resolves.toEqual({
      args: ["--not-an-option", "-x"],
      options: {} as { apply: boolean },
    });
  });

  test("rejects missing long option values when the next token is another option", async () => {
    await expect(
      parseArgvTail(["--target", "--apply"], {
        apply: { type: "boolean" },
        target: { type: "string" },
      } as const),
    ).rejects.toThrow(ParserUsageError);

    await expect(
      parseArgvTail(["--concurrency", "--apply"], {
        apply: { type: "boolean" },
        concurrency: { type: "number" },
      } as const),
    ).rejects.toThrow('Option "--concurrency" expects a value.');
  });

  test("rejects duplicate scalar flags instead of silently using the last value", async () => {
    await expect(
      parseArgvTail(["--target", "apps/web", "--target", "apps/rse"], {
        target: { type: "string" },
      } as const),
    ).rejects.toThrow('Option "--target" was provided more than once.');

    await expect(
      parseArgvTail(["--autoinstall", "--no-autoinstall"], {
        autoinstall: { type: "boolean", defaultValue: true },
      } as const),
    ).rejects.toThrow('Option "--no-autoinstall" was provided more than once.');
  });

  test("rejects duplicate values across short and long aliases", async () => {
    await expect(
      parseArgvTail(["-t", "apps/web", "--target", "apps/rse"], {
        target: { type: "string", short: "t" },
      } as const),
    ).rejects.toThrow('Option "--target" was provided more than once.');
  });

  test("allows option values that start with a dash through equals syntax", async () => {
    await expect(
      parseArgvTail(["--target=-fixture"], {
        target: { type: "string" },
      } as const),
    ).resolves.toEqual({
      args: [],
      options: { target: "-fixture" },
    });
  });
});
