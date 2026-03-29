export interface RunNpmPublishOptions {
  readonly cwd: string;
  readonly dryRun: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly tag?: string | undefined;
}

export interface RunNpmPublishResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return new Response(stream).text();
}

/**
 * Runs `npm publish` from `cwd` (staging directory). Caller must be logged into npm for non–dry-run.
 * Workspace protocol / catalog deps are not rewritten in v1 — real publishes may fail until versions are resolved.
 */
export async function runNpmPublish(options: RunNpmPublishOptions): Promise<RunNpmPublishResult> {
  const args = ["publish", "--access", "public"];
  if (options.dryRun) {
    args.push("--dry-run");
  }

  if (options.tag && options.tag.trim().length > 0) {
    args.push("--tag", options.tag.trim());
  }

  const child = Bun.spawn(["npm", ...args], {
    cwd: options.cwd,
    env: options.env,
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
