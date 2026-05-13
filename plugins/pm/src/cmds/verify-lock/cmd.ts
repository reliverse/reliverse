import { defineCommand } from "@reliverse/rempts";

import { assertSupportedBunLockfileProject, verifyBunLock } from "../../lib";

function infoLabel(
  ctx: {
    colors: {
      stdout: { bold(text: string): string; cyan(text: string): string };
    };
  },
  text: string,
): string {
  return ctx.colors.stdout.cyan(ctx.colors.stdout.bold(text));
}

function okLabel(
  ctx: {
    colors: {
      stdout: { bold(text: string): string; green(text: string): string };
    };
  },
  text: string,
): string {
  return ctx.colors.stdout.green(ctx.colors.stdout.bold(text));
}

function normalizeSocketSeverity(
  value: unknown,
  exit: (code: number, message: string) => never,
): "low" | "medium" | "high" | "critical" | undefined {
  if (value === undefined) return undefined;
  const severity = String(value).trim();
  if (severity === "middle") return "medium";
  if (
    severity === "low" ||
    severity === "medium" ||
    severity === "high" ||
    severity === "critical"
  ) {
    return severity;
  }

  return exit(
    1,
    'Invalid --socket-severity-threshold: use "low", "medium"/"middle", "high", or "critical".',
  );
}

export default defineCommand({
  meta: {
    name: "verify-lock",
    description:
      "Verify Bun lockfile package integrity and optionally check the installed tree with Socket.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  help: {
    examples: [
      "rse verify-lock",
      "rse verify-lock --json",
      "rse verify-lock --socket --json",
      "rse verify-lock --require-socket --socket-severity-threshold high --json",
    ],
    text: "Parses bun.lock, verifies resolved package entries include integrity metadata, and can run Socket shallow checks against every resolved package version. Only modern Bun projects with bun.lock are supported.",
  },
  options: {
    cwd: {
      type: "string",
      defaultValue: ".",
      description: "Project directory containing bun.lock",
      inputSources: ["flag", "default"],
    },
    socket: {
      type: "boolean",
      description: "Run optional Socket shallow checks for every resolved lockfile package",
      inputSources: ["flag"],
    },
    requireSocket: {
      type: "boolean",
      description: "Fail when Socket shallow checks are unavailable or report blocking alerts",
      inputSources: ["flag"],
    },
    socketSeverityThreshold: {
      type: "string",
      description: "Lowest Socket alert severity that fails verification",
      hint: "low | medium | middle | high | critical",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    await assertSupportedBunLockfileProject(ctx.options.cwd);

    const socketSeverityThreshold = normalizeSocketSeverity(
      ctx.options.socketSeverityThreshold,
      ctx.exit,
    );
    const result = await verifyBunLock({
      cwd: ctx.options.cwd,
      requireSocket: ctx.options.requireSocket === true,
      socket: ctx.options.socket === true,
      socketSeverityThreshold,
    });

    if (ctx.output.mode === "json") {
      ctx.output.result(result, "pm verify-lock");
    } else {
      ctx.out(okLabel(ctx, result.ok ? "pm verify-lock" : "pm verify-lock failed"));
      ctx.out(`${infoLabel(ctx, "Lockfile:")} ${result.lockfilePath}`);
      ctx.out(`${infoLabel(ctx, "Checked packages:")} ${result.checkedPackages}`);
      if (result.socket) {
        ctx.out(
          `${infoLabel(ctx, "Socket:")} ${result.socket.require ? "required" : "enabled"}, threshold ${result.socket.severityThreshold}`,
        );
      }
      if (result.issues.length > 0) {
        ctx.out(infoLabel(ctx, "Issues:"));
        for (const issue of result.issues.slice(0, 20)) {
          ctx.out(
            `- ${issue.packageName ?? "lockfile"}${issue.version ? `@${issue.version}` : ""}: ${issue.reason}`,
          );
        }
      }
    }

    if (!result.ok) {
      ctx.exit(1, `bun.lock verification failed with ${result.issues.length} issue(s).`);
    }
  },
});
