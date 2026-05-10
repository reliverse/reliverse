import { defineCommand } from "@reliverse/rempts";

export const npmRegistry = "https://registry.npmjs.org/";
export const npmTokenUrl =
  "https://www.npmjs.com/settings/<username>/tokens/granular-access-tokens/new";

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

export function createNpmOnboardingLines(): string[] {
  return [
    "npm auth is not ready for dler publish.",
    "",
    "Create a granular npm access token:",
    `  ${npmTokenUrl}`,
    "",
    "Navigation: Profile → Access Tokens → Generate New Token",
    "",
    "Example token settings:",
    "  Token name*: dler-reliverse-os",
    "  Description: Publishes packages via rse dler pub. Intended only for blefnk@reliverse-os.",
    "  Bypass 2FA: true",
    "  Allowed IP ranges:",
    "    curl -4fsS https://ifconfig.me; echo # <IPv4 output>/32",
    "    curl -6fsS https://ifconfig.me; echo || true # <IPv6 output>/128",
    "  Packages and scopes > Permissions: Read and write",
    "  Organizations > Permissions: Read and write",
    "  Organizations > Select organizations: reliverse",
    "  Expiration: 90 days",
    "  Click: Generate token",
    "  Then copy the token.",
    "",
    "After copying the token, run this command to replace the current npmrc auth safely:",
    "",
    npmrcInstallCommand,
    "",
    `Then retry: npm whoami --registry=${npmRegistry}`,
    "Then retry your publish command, e.g. `bun rse pub --apply`.",
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
  },
  help: {
    examples: ["rse pub onboard", "rse pub --apply"],
    text: "Prints non-interactive npm granular token setup instructions. No token is requested by this command.",
  },
  async handler(ctx) {
    const payload = {
      npmRegistry,
      npmTokenUrl,
      npmrcInstallCommand,
      tokenSettings: {
        allowedIpRangeCommands: [
          "curl -4fsS https://ifconfig.me; echo # <IPv4 output>/32",
          "curl -6fsS https://ifconfig.me; echo || true # <IPv6 output>/128",
        ],
        bypass2fa: true,
        description: "Publishes packages via rse dler pub. Intended only for blefnk@reliverse-os.",
        expiration: "90 days",
        organizationPermissions: "Read and write",
        organizations: ["reliverse"],
        packagePermissions: "Read and write",
        tokenName: "dler-reliverse-os",
      },
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(payload, "pub onboard");
      return;
    }

    for (const line of createNpmOnboardingLines()) {
      ctx.out(line);
    }
  },
});
