import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function loadCli() {
  return await import("./direct-cli");
}

describe("standalone relpack CLI", () => {
  test("prints direct help without requiring the rse wrapper", async () => {
    const { runRelpackCli } = await loadCli();
    const lines: string[] = [];

    const code = await runRelpackCli([], { stdout: (message) => lines.push(message) });

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("relpack doctor");
    expect(lines.join("\n")).toContain("rse relpack <command>");
  });

  test("prints command-specific help", async () => {
    const { runRelpackCli } = await loadCli();
    const lines: string[] = [];

    const code = await runRelpackCli(["pack", "--help"], {
      stdout: (message) => lines.push(message),
    });

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Usage:");
    expect(lines.join("\n")).toContain("relpack pack <input...> -o <archive>");
    expect(lines.join("\n")).toContain("--show-skipped");
  });

  test("packs, verifies, and lists through the direct CLI", async () => {
    const { runRelpackCli } = await loadCli();
    const cwd = await mkdtemp(path.join(tmpdir(), "relpack-direct-cli-"));
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.2.3" }),
    );
    await writeFile(path.join(cwd, "src", "index.ts"), "export const ok = true;\n");

    const output = path.join(cwd, "fixture.zip");
    const packed = await runRelpackCli(["pack", "package.json", "src", "-o", output, "--apply"], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(packed).toBe(0);

    const verified = await runRelpackCli(["verify", output], {
      cwd,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(verified).toBe(0);

    const listLines: string[] = [];
    const listed = await runRelpackCli(["list", output, "--tree", "--max-depth", "2"], {
      cwd,
      stdout: (message) => listLines.push(message),
      stderr: () => undefined,
    });
    expect(listed).toBe(0);
    expect(listLines.join("\n")).toContain("Relpack list");
    expect(listLines.join("\n")).toContain("fixture");
  });

  test("maps batch archive outputs like the wrapper command", async () => {
    const { runRelpackCli } = await loadCli();
    const cwd = await mkdtemp(path.join(tmpdir(), "relpack-direct-batch-"));

    for (const name of ["rse", "relpack"]) {
      const dir = path.join(cwd, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.1.2" }));
      await writeFile(path.join(dir, "README.md"), `${name}\n`);
      const code = await runRelpackCli(
        ["pack", "package.json", "README.md", "-o", path.join(cwd, `${name}-0.1.2.zip`), "--apply"],
        {
          cwd: dir,
          stdout: () => undefined,
          stderr: () => undefined,
        },
      );
      expect(code).toBe(0);
    }

    const appOut = path.join(cwd, "apps", "rse");
    const pluginOut = path.join(cwd, "plugins", "relpack");
    const code = await runRelpackCli(
      [
        "unpack",
        "./rse-*.zip",
        "./relpack-*.zip",
        "-o",
        appOut,
        pluginOut,
        "--overwrite-mode",
        "clean",
        "--backup",
        "--rollback-on-fail",
        "--post-check-command",
        "test -f apps/rse/package.json && test -f plugins/relpack/package.json",
        "--delete-archive",
        "--apply",
      ],
      {
        cwd,
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(await readFile(path.join(appOut, "package.json"), "utf8")).toContain('"name":"rse"');
    expect(await readFile(path.join(pluginOut, "package.json"), "utf8")).toContain(
      '"name":"relpack"',
    );
  });
});
