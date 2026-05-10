export interface RunNpmPackDryRunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface NpmPackFile {
  readonly path: string;
  readonly size?: number | undefined;
  readonly mode?: number | undefined;
}

export interface NpmPackPreview {
  readonly filename?: string | undefined;
  readonly files: readonly NpmPackFile[];
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly packageSize?: number | undefined;
  readonly unpackedSize?: number | undefined;
  readonly version?: string | undefined;
}

export interface RunNpmPackDryRunResult {
  readonly exitCode: number;
  readonly preview?: NpmPackPreview | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";

  return new Response(stream).text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePackPreview(stdout: string): NpmPackPreview | undefined {
  const parsed = JSON.parse(stdout) as unknown;
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(first)) return undefined;

  const files = Array.isArray(first.files)
    ? first.files.flatMap((file): NpmPackFile[] => {
        if (!isRecord(file) || typeof file.path !== "string") return [];

        return [{
          mode: typeof file.mode === "number" ? file.mode : undefined,
          path: file.path,
          size: typeof file.size === "number" ? file.size : undefined,
        }];
      })
    : [];

  return {
    filename: typeof first.filename === "string" ? first.filename : undefined,
    files,
    id: typeof first.id === "string" ? first.id : undefined,
    name: typeof first.name === "string" ? first.name : undefined,
    packageSize: typeof first.size === "number" ? first.size : undefined,
    unpackedSize: typeof first.unpackedSize === "number" ? first.unpackedSize : undefined,
    version: typeof first.version === "string" ? first.version : undefined,
  };
}

export async function runNpmPackDryRun(
  options: RunNpmPackDryRunOptions,
): Promise<RunNpmPackDryRunResult> {
  const child = Bun.spawn(["npm", "pack", "--dry-run", "--json"], {
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

  let preview: NpmPackPreview | undefined;
  if (exitCode === 0 && stdout.trim().length > 0) {
    try {
      preview = parsePackPreview(stdout);
    } catch {
      preview = undefined;
    }
  }

  return { exitCode, preview, stderr, stdout };
}
