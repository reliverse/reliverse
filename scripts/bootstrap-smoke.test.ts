import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const readJson = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8"));

test("public workspaces have unique names and complete workspace/catalog references", async () => {
  const manifest = await readJson("package.json");
  expect(manifest.packageManager).toBe(`bun@${Bun.version}`);
  const paths = new Set<string>();
  for (const pattern of manifest.workspaces.packages as string[]) {
    const found = [
      ...new Bun.Glob(`${pattern}/package.json`).scanSync({
        cwd: root,
        onlyFiles: true,
        followSymlinks: false,
      }),
    ];
    if (!pattern.includes("*")) expect(found.length).toBeGreaterThan(0);
    for (const file of found) paths.add(file);
  }
  // Retained public surfaces must not disappear behind newer-layout globs.
  for (const file of [
    "apps/rse/package.json",
    "apps/web/package.json",
    "apps/wiki/package.json",
    "plugins/dler/package.json",
    "packages/rempts/package.json",
  ])
    expect(paths.has(file)).toBe(true);
  const packages = await Promise.all([...paths].map(readJson));
  const names = packages.map((m) => m.name);
  expect(new Set(names).size).toBe(names.length);
  for (const pkg of [manifest, ...packages]) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, raw] of Object.entries(pkg[field] ?? {})) {
        expect(typeof raw).toBe("string");
        let spec = raw as string;
        if (spec.startsWith("catalog:")) {
          const catalog = spec.slice(8);
          const resolved = (
            catalog ? manifest.workspaces.catalogs?.[catalog] : manifest.workspaces.catalog
          )?.[name];
          expect(typeof resolved).toBe("string");
          expect(resolved.startsWith("catalog:")).toBe(false);
          spec = resolved;
        }
        if (spec.startsWith("workspace:")) expect(names).toContain(name);
      }
    }
  }
});

test("source publication cannot trigger the manual production deployment workflow", async () => {
  const workflow = Bun.YAML.parse(
    await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8"),
  ) as {
    on: Record<string, unknown>;
    jobs: { deploy: { if: string; environment: string } };
    permissions: { contents: string };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.jobs.deploy.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs.deploy.if).not.toContain("github.event_name == 'push'");
  expect(workflow.jobs.deploy.environment).toBe("production");
  expect(workflow.permissions.contents).toBe("read");
});

for (const args of [["--help"], ["dler", "build", "--help"], ["dler", "tsc", "--help"]]) {
  test(`read-only CLI smoke: rse ${args.join(" ")}`, async () => {
    const home = await mkdtemp(path.join(tmpdir(), "reliverse-smoke-"));
    const before = await readFile(path.join(root, "bun.lock"));
    try {
      const child = Bun.spawn([process.execPath, "--no-env-file", "apps/rse/src/cli.ts", ...args], {
        cwd: root,
        env: {
          HOME: home,
          PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
          CI: "1",
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      try {
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect({ code, error: code === 0 ? "" : stderr }).toEqual({ code: 0, error: "" });
        expect(stdout).toContain("Usage");
      } finally {
        clearTimeout(timer);
      }
      expect(await readFile(path.join(root, "bun.lock"))).toEqual(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 15000);
}

type DeployFixture = {
  baseline?: "link" | "directory" | "absent";
  installCode?: number;
  buildCode?: number;
  restartFails?: boolean;
  healthFails?: boolean;
  recoveryFails?: boolean;
};

async function deployFixture(options: DeployFixture = {}) {
  const { mkdir, writeFile, symlink, realpath } = await import("node:fs/promises");
  const sandbox = await mkdtemp(path.join(tmpdir(), "deploy-recovery-"));
  const base = path.join(sandbox, "prod");
  const current = path.join(base, "current");
  const source = path.join(sandbox, "source");
  const bin = path.join(sandbox, "bin");
  const home = path.join(sandbox, "home");
  try {
    for (const dir of [bin, source, path.join(home, ".local/bin"), path.join(base, "releases/old"), path.join(base, "releases/older")]) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(path.join(source, "package.json"), JSON.stringify({ scripts: { build: "fixture" } }));
    await writeFile(path.join(source, ".deploy-sha"), "candidate\n");
    await writeFile(path.join(base, "releases/old/.deploy-sha"), "old\n");
    await symlink(path.join(base, "releases/older"), path.join(base, "previous"));
    const baseline = options.baseline ?? "link";
    if (baseline === "link") await symlink(path.join(base, "releases/old"), current);
    if (baseline === "directory") {
      await mkdir(current);
      await writeFile(path.join(current, ".deploy-sha"), "old\n");
    }
    const resolver = path.join(home, ".local/bin/bleverse-deploy-app");
    await writeFile(resolver, `#!/bin/bash\nprintf '%s\\n' '${JSON.stringify({ id: "fixture", repoDir: current, repo: "reliverse/reliverse", workspacePath: ".", service: "fixture.service", smokeUrl: "http://fixture.invalid" })}'\n`, { mode: 0o700 });
    await writeFile(path.join(sandbox, "registry.json"), "{}");
    const mock = `#!/bin/bash
set -eu
name="\${0##*/}"
marker="$(cat "$FIXTURE_CURRENT/.deploy-sha" 2>/dev/null || echo absent)"
case "$name" in
  git)
    if [[ "$1" == clone ]]; then cp -a "$FIXTURE_SOURCE/." "\${@: -1}/";
    elif [[ "$3" == rev-parse ]]; then echo candidate; fi ;;
  rsync) cp -a "\${@: -2:1}." "\${@: -1}" ;;
  ssh-keygen) exit 0 ;;
  bun)
    echo "bun:$1:$marker" >> "$FIXTURE_TRACE"
    if [[ "$1" == install ]]; then exit "$FIXTURE_INSTALL_CODE"; fi
    exit "$FIXTURE_BUILD_CODE" ;;
  timeout) shift 3; exec "$@" ;;
  systemctl)
    echo "systemctl:$2:$marker" >> "$FIXTURE_TRACE"
    if [[ "$2" == restart && "$marker" == candidate && "$FIXTURE_RESTART_FAILS" == 1 ]]; then exit 9; fi
    if [[ "$2" == restart && "$marker" == old && "$FIXTURE_RECOVERY_FAILS" == 1 ]]; then exit 10; fi ;;
  curl)
    echo "curl:$marker" >> "$FIXTURE_TRACE"
    if [[ "$marker" == candidate && "$FIXTURE_HEALTH_FAILS" == 1 ]]; then exit 22; fi ;;
  *) exit 99 ;;
esac
`;
    for (const name of ["git", "rsync", "ssh-keygen", "bun", "timeout", "systemctl", "curl"]) {
      await writeFile(path.join(bin, name), mock, { mode: 0o700 });
    }
    const workflow = Bun.YAML.parse(await readFile(path.join(root, ".github/workflows/deploy.yml"), "utf8")) as {
      jobs: { deploy: { steps: { run?: string }[] } };
    };
    const step = workflow.jobs.deploy.steps.find((item) => item.run?.includes("cat <<'REMOTE_BASH'"));
    const script = step?.run?.split("cat <<'REMOTE_BASH'\n")[1]?.split("\nREMOTE_BASH")[0];
    if (!script) throw new Error("Missing literal remote deployment script");
    const child = Bun.spawn(["/bin/bash", "-c", script], {
      cwd: sandbox,
      env: {
        HOME: home, PATH: `${bin}:/usr/bin:/bin`,
        DEPLOY_TARGET_REF: "candidate", DEPLOY_SELECTORS: "fixture",
        DEPLOY_SOURCE_ROOT: path.join(sandbox, "checkouts"),
        DEPLOY_REGISTRY_PATH: path.join(sandbox, "registry.json"),
        XDG_RUNTIME_DIR: path.join(sandbox, "runtime"),
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-fixture-bus",
        FIXTURE_CURRENT: current, FIXTURE_SOURCE: source,
        FIXTURE_TRACE: path.join(sandbox, "trace"),
        FIXTURE_INSTALL_CODE: String(options.installCode ?? 0),
        FIXTURE_BUILD_CODE: String(options.buildCode ?? 0),
        FIXTURE_RESTART_FAILS: options.restartFails ? "1" : "0",
        FIXTURE_HEALTH_FAILS: options.healthFails ? "1" : "0",
        FIXTURE_RECOVERY_FAILS: options.recoveryFails ? "1" : "0",
      },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    let result;
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      result = { code, output: stdout + stderr };
    } finally { clearTimeout(timer); }
    const marker = await readFile(path.join(current, ".deploy-sha"), "utf8").catch(() => "absent");
    const trace = await readFile(path.join(sandbox, "trace"), "utf8").catch(() => "");
    const previous = await realpath(path.join(base, "previous")).catch(() => "absent");
    const history = await readFile(path.join(base, "metadata/history.jsonl"), "utf8").catch(() => "");
    return { ...result, marker: marker.trim(), trace, previous: path.basename(previous), history };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

for (const baseline of ["link", "directory", "absent"] as const) {
  for (const buildCode of [7, 124]) {
    test(`deploy recovery: ${baseline} build failure preserves status ${buildCode} without cutover`, async () => {
      const result = await deployFixture({ baseline, buildCode });
      expect(result.code).toBe(buildCode);
      expect(result.marker).toBe(baseline === "absent" ? "absent" : "old");
      expect(result.trace).not.toContain("systemctl:");
      expect(result.history).toBe("");
      if (buildCode === 124) expect(result.output).toContain("build timed out");
    });
  }
  test(`deploy recovery: ${baseline} successful build precedes cutover`, async () => {
    const result = await deployFixture({ baseline });
    expect({ code: result.code, error: result.code ? result.output : "" }).toEqual({ code: 0, error: "" });
    expect(result.marker).toBe("candidate");
    expect(result.trace).toContain(`bun:run:${baseline === "absent" ? "absent" : "old"}`);
    expect(result.trace).toContain("systemctl:restart:candidate");
    expect(result.trace).not.toContain("systemctl:stop:");
    expect(result.history).toContain("candidate");
  });
  test(`deploy recovery: ${baseline} health failure restores baseline`, async () => {
    const result = await deployFixture({ baseline, healthFails: true });
    expect(result.code).not.toBe(0);
    expect(result.marker).toBe(baseline === "absent" ? "absent" : "old");
    expect(result.trace).toContain(baseline === "absent" ? "systemctl:stop:absent" : "systemctl:restart:old");
    expect(result.output).not.toContain("RECOVERY UNVERIFIED");
    expect(result.previous).toBe("older");
    expect(result.history).toBe("");
  });
}

test("deploy recovery: install failure leaves serving release untouched", async () => {
  const result = await deployFixture({ installCode: 6 });
  expect(result.code).toBe(6);
  expect(result.marker).toBe("old");
  expect(result.trace).not.toContain("systemctl:");
});

test("deploy recovery: failed restart restores and checks the old service", async () => {
  const result = await deployFixture({ restartFails: true });
  expect(result.code).toBe(9);
  expect(result.marker).toBe("old");
  expect(result.trace).toContain("systemctl:is-active:old");
  expect(result.trace).toContain("curl:old");
});

test("deploy recovery: failed recovery remains explicitly unverified", async () => {
  const result = await deployFixture({ healthFails: true, recoveryFails: true });
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("RECOVERY UNVERIFIED");
  expect(result.output).not.toContain("finished successfully");
});


test("public bootstrap fixtures resolve Rempts from their own source, not an operator checkout", async () => {
  for (const file of ["packages/rempts/src/runtime/command-diagnostics.test.ts", "packages/rempts/src/runtime/discover-command.test.ts", "packages/rempts/src/api/create-cli.test.ts"]) {
    const source = await readFile(path.join(root, file), "utf8");
    expect(source).not.toMatch(/["']\/(?:home|Users)\/[^"']+\/packages\/rempts\/src\//);
    expect(source).toContain("import.meta.url");
  }
});

test("OS bootstrap helpers are syntax-valid and advertise a generic maintenance account without applying changes", async () => {
  for (const name of ["00-preflight.sh", "10-host-identity.sh"]) {
    const script = path.join(root, "plugins/os/src/cmds/os/bootstrap/scripts", name);
    for (const args of [["-n", script], [script, "--help"]]) {
      const child = Bun.spawn(["/bin/bash", ...args], { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5000 });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, error: code ? stderr : "" }).toEqual({ code: 0, error: "" });
      if (args[0] !== "-n") expect(stdout).toContain(name === "10-host-identity.sh" ? "--dev-user" : "RELIVERSE_DEV_USER");
    }
  }
});
