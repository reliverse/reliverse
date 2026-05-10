import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { defineCommand } from "@reliverse/rempts";

export const npmRegistry = "https://registry.npmjs.org/";
export const npmTokenUrl =
  "https://www.npmjs.com/settings/<username>/tokens/granular-access-tokens/new";

function createNpmTokenUrl(username: string | undefined): string {
  return `https://www.npmjs.com/settings/${username?.trim() || "<username>"}/tokens/granular-access-tokens/new`;
}

export const npmrcInstallCommand = String.raw`cp ~/.npmrc ~/.npmrc.bak.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true

tmp="$(mktemp)"
grep -vE '(^//registry\.npmjs\.org/:_authToken=|^registry=|^@reliverse:registry=)' ~/.npmrc 2>/dev/null > "$tmp" || true
mv "$tmp" ~/.npmrc

read -rsp "npm token: " NPM_TOKEN; echo
{
 printf 'registry=https://registry.npmjs.org/\n'
 printf '@reliverse:registry=https://registry.npmjs.org/\n'
 printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN"
} >> ~/.npmrc
chmod 600 ~/.npmrc
unset NPM_TOKEN

grep -nE 'registry|_authToken|always-auth|@reliverse:registry' ~/.npmrc .npmrc 2>/dev/null \
 | sed -E 's#(_authToken=).*#\1***#'`;

interface OnboardColors {
  bold(value: string): string;
  cyan(value: string): string;
  gray(value: string): string;
  green(value: string): string;
  magenta(value: string): string;
  yellow(value: string): string;
}

function identity(value: string): string {
  return value;
}

function getColors(colors?: OnboardColors | undefined): OnboardColors {
  return (
    colors ?? {
      bold: identity,
      cyan: identity,
      gray: identity,
      green: identity,
      magenta: identity,
      yellow: identity,
    }
  );
}

interface NpmWhoamiResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface IpRangeHints {
  readonly ipv4?: string | undefined;
  readonly ipv6?: string | undefined;
}

interface OnboardContextInfo {
  readonly ipRanges: IpRangeHints;
  readonly npmTokenUrl: string;
  readonly username?: string | undefined;
  readonly whoami?: NpmWhoamiResult | undefined;
}

interface WriteNpmrcResult {
  readonly backupPath?: string | undefined;
  readonly npmrcPath: string;
  readonly tokenSource: "env" | "stdin";
}

const managedNpmrcLinePattern =
  /^(?:\/\/registry\.npmjs\.org\/:_authToken=|registry=|@reliverse:registry=)/;

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runTextCommand(args: readonly string[]): Promise<NpmWhoamiResult> {
  const child = Bun.spawn([...args], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessStream(child.stdout),
    readProcessStream(child.stderr),
    child.exited,
  ]);

  return { exitCode, stderr, stdout };
}

async function readNpmUsername(env: NodeJS.ProcessEnv): Promise<NpmWhoamiResult> {
  const child = Bun.spawn(["npm", "whoami", `--registry=${npmRegistry}`], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessStream(child.stdout),
    readProcessStream(child.stderr),
    child.exited,
  ]);

  return { exitCode, stderr, stdout };
}

function normalizeIp(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function readIpRangeHints(): Promise<IpRangeHints> {
  const [ipv4, ipv6] = await Promise.all([
    runTextCommand(["curl", "-4fsS", "https://ifconfig.me"]).catch(() => undefined),
    runTextCommand(["curl", "-6fsS", "https://ifconfig.me"]).catch(() => undefined),
  ]);

  return {
    ipv4: ipv4?.exitCode === 0 ? normalizeIp(ipv4.stdout) : undefined,
    ipv6: ipv6?.exitCode === 0 ? normalizeIp(ipv6.stdout) : undefined,
  };
}

async function getOnboardContextInfo(env: NodeJS.ProcessEnv): Promise<OnboardContextInfo> {
  const [whoami, ipRanges] = await Promise.all([
    readNpmUsername(env).catch(() => undefined),
    readIpRangeHints(),
  ]);
  const username = whoami?.exitCode === 0 ? whoami.stdout.trim() || undefined : undefined;

  return {
    ipRanges,
    npmTokenUrl: createNpmTokenUrl(username),
    username,
    whoami,
  };
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizeToken(value: string): string {
  return value.trim();
}

async function readExistingNpmrc(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveToken(ctx: {
  env: NodeJS.ProcessEnv;
  input: { available: boolean; text(): Promise<string> };
}): Promise<{
  readonly source: "env" | "stdin";
  readonly token: string;
}> {
  const envToken = normalizeToken(ctx.env.NPM_TOKEN ?? "");
  if (envToken) return { source: "env", token: envToken };

  if (ctx.input.available) {
    const stdinToken = normalizeToken(await ctx.input.text());
    if (stdinToken) return { source: "stdin", token: stdinToken };
  }

  throw new Error(
    "--write-npmrc requires an npm token via NPM_TOKEN env or piped stdin. Example: NPM_TOKEN=... bun rse pub onboard --write-npmrc --apply",
  );
}

async function writeNpmrcAuth(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly input: { available: boolean; text(): Promise<string> };
}): Promise<WriteNpmrcResult> {
  const { source, token } = await resolveToken(options);
  const npmrcPath = join(homedir(), ".npmrc");
  const existing = await readExistingNpmrc(npmrcPath);
  const backupPath = existing === undefined ? undefined : `${npmrcPath}.bak.${formatTimestamp()}`;
  const preservedLines = (existing ?? "")
    .split("\n")
    .filter((line) => line.length > 0 && !managedNpmrcLinePattern.test(line));
  const next = [
    ...preservedLines,
    "registry=https://registry.npmjs.org/",
    "@reliverse:registry=https://registry.npmjs.org/",
    `//registry.npmjs.org/:_authToken=${token}`,
    "",
  ].join("\n");
  const tmpPath = `${npmrcPath}.tmp.${process.pid}.${Date.now()}`;

  await mkdir(dirname(npmrcPath), { recursive: true });
  if (existing !== undefined && backupPath) {
    await copyFile(npmrcPath, backupPath);
    await chmod(backupPath, 0o600);
  }
  await writeFile(tmpPath, next, { encoding: "utf8", mode: 0o600 });
  await chmod(tmpPath, 0o600);
  await rename(tmpPath, npmrcPath);
  await chmod(npmrcPath, 0o600);

  return { backupPath, npmrcPath, tokenSource: source };
}

function formatShellBlock(command: string, colors: OnboardColors): string {
  return command
    .split("\n")
    .map((line) => colors.gray(line))
    .join("\n");
}

export function createNpmOnboardingLines(
  colorsInput?: OnboardColors | undefined,
  info?: OnboardContextInfo | undefined,
): string[] {
  const colors = getColors(colorsInput);
  const heading = (value: string) => colors.bold(colors.cyan(value));
  const key = (value: string) => colors.bold(value);
  const command = (value: string) => colors.magenta(value);

  return [
    colors.yellow(colors.bold("npm auth is not ready for dler publish.")),
    "",
    ...(info?.whoami && info.whoami.exitCode !== 0
      ? [
          `${key("Why:")} ${colors.yellow(`npm whoami --registry=${npmRegistry} failed, so dler cannot publish yet.`)}`,
          info.whoami.stderr.trim()
            ? `  ${colors.gray(info.whoami.stderr.trim().split("\n")[0] ?? "")}`
            : undefined,
          "",
        ].filter((line): line is string => typeof line === "string")
      : []),
    heading("Create a granular npm access token"),
    `  ${colors.green(info?.npmTokenUrl ?? npmTokenUrl)}`,
    "",
    `${key("Navigation:")} ${colors.cyan("Profile → Access Tokens → Generate New Token")}`,
    "",
    heading("Example token settings"),
    `  ${key("Token name:")} ${colors.green("dler-reliverse-os")}`,
    `  ${key("Description:")} Publishes packages via rse pub. Intended only for blefnk@reliverse-os.`,
    `  ${key("Bypass 2FA:")} ${colors.green("true")}`,
    `  ${key("Allowed IP ranges:")}`,
    info?.ipRanges.ipv4
      ? `    ${colors.green(`${info.ipRanges.ipv4}/32`)} ${colors.gray("# current IPv4")}`
      : `    ${command("curl -4fsS https://ifconfig.me; echo")} ${colors.gray("# <IPv4 output>/32")}`,
    info?.ipRanges.ipv6
      ? `    ${colors.green(`${info.ipRanges.ipv6}/128`)} ${colors.gray("# current IPv6")}`
      : `    ${command("curl -6fsS https://ifconfig.me; echo || true")} ${colors.gray("# <IPv6 output>/128")}`,
    `  ${key("Packages and scopes > Permissions:")} ${colors.green("Read and write")}`,
    `  ${key("Organizations > Permissions:")} ${colors.green("Read and write")}`,
    `  ${key("Organizations > Select organizations:")} ${colors.green("reliverse")}`,
    `  ${key("Expiration:")} ${colors.yellow("90 days")}`,
    `  ${key("Click:")} ${colors.green("Generate token")}`,
    `  ${colors.green("Then copy the token.")}`,
    "",
    colors.yellow(
      "Note: If npm 2FA popups fail on Windows in Firefox-like browsers, try generating the token in a Chromium-based browser.",
    ),
    colors.yellow(
      "Note: Do not commit npm auth tokens. Keep tokens only in ~/.npmrc or secret storage.",
    ),
    "",
    heading("Install token into ~/.npmrc"),
    "  After copying the token, run this command to replace the current npmrc auth safely:",
    "",
    formatShellBlock(npmrcInstallCommand, colors),
    "",
    `${key("Verify:")} ${command(`npm whoami --registry=${npmRegistry}`)}`,
    `${key("Retry:")} ${command("bun rse pub --apply")}`,
  ];
}

export default defineCommand({
  meta: {
    name: "onboard",
    description: "Print npm token onboarding steps for dler publish.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write"],
  },
  help: {
    examples: [
      "rse pub onboard",
      "rse pub onboard --write-npmrc --apply",
      "NPM_TOKEN=... rse pub onboard --write-npmrc --apply",
      "printf '%s' \"$NPM_TOKEN\" | rse pub onboard --write-npmrc --apply",
      "rse pub --apply",
    ],
    text: "Prints non-interactive npm granular token setup instructions. With --write-npmrc --apply, writes ~/.npmrc from NPM_TOKEN env or piped stdin.",
  },
  options: {
    writeNpmrc: {
      type: "boolean",
      description: "Write ~/.npmrc using NPM_TOKEN env or piped stdin. Requires --apply.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const onboardInfo = await getOnboardContextInfo(ctx.env);
    const payload = {
      ipRanges: {
        ipv4: onboardInfo.ipRanges.ipv4 ? `${onboardInfo.ipRanges.ipv4}/32` : undefined,
        ipv6: onboardInfo.ipRanges.ipv6 ? `${onboardInfo.ipRanges.ipv6}/128` : undefined,
      },
      npmRegistry,
      npmTokenUrl: onboardInfo.npmTokenUrl,
      npmrcInstallCommand,
      username: onboardInfo.username,
      tokenSettings: {
        allowedIpRangeCommands: [
          "curl -4fsS https://ifconfig.me; echo # <IPv4 output>/32",
          "curl -6fsS https://ifconfig.me; echo || true # <IPv6 output>/128",
        ],
        browser2faNote:
          "If npm 2FA popups fail on Windows in Firefox-like browsers, try generating the token in a Chromium-based browser.",
        bypass2fa: true,
        description: "Publishes packages via rse pub. Intended only for blefnk@reliverse-os.",
        expiration: "90 days",
        organizationPermissions: "Read and write",
        organizations: ["reliverse"],
        packagePermissions: "Read and write",
        tokenName: "dler-reliverse-os",
      },
    };

    if (ctx.options.writeNpmrc === true) {
      if (!ctx.safety.apply) {
        ctx.exit(
          1,
          "Pass --apply to write ~/.npmrc, or omit --write-npmrc to print onboarding instructions.",
        );
      }

      ctx.safety.assertApplied("fs.write");
      const result = await writeNpmrcAuth({
        env: ctx.env,
        input: ctx.input,
      });
      const writePayload = {
        ...payload,
        npmrc: {
          backupPath: result.backupPath,
          path: result.npmrcPath,
          tokenSource: result.tokenSource,
          wrote: true,
        },
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(writePayload, "pub onboard");
        return;
      }

      ctx.out(ctx.colors.stdout.green(ctx.colors.stdout.bold("Updated ~/.npmrc for npm publish.")));
      ctx.out(`${ctx.colors.stdout.bold("Path:")} ${result.npmrcPath}`);
      if (result.backupPath) {
        ctx.out(`${ctx.colors.stdout.bold("Backup:")} ${result.backupPath}`);
      }
      ctx.out(`${ctx.colors.stdout.bold("Token source:")} ${result.tokenSource}`);
      ctx.out(
        `${ctx.colors.stdout.bold("Verify:")} ${ctx.colors.stdout.magenta(`npm whoami --registry=${npmRegistry}`)}`,
      );
      ctx.out(
        `${ctx.colors.stdout.bold("Retry:")} ${ctx.colors.stdout.magenta("bun rse pub --apply")}`,
      );
      return;
    }

    if (ctx.output.mode === "json") {
      ctx.output.result(payload, "pub onboard");
      return;
    }

    for (const line of createNpmOnboardingLines(ctx.colors.stdout, onboardInfo)) {
      ctx.out(line);
    }
  },
});
