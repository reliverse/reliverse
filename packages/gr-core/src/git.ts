import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { GrError } from "./error";
import { isGrSnapshotIndex } from "./git-index";

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Supplied only by an admitted host: includes Git/interpreter/helper custody.
 * This execution context grants no Git effects, CapRef or Gatehouse authority.
 */
export interface GrGitRuntime {
  readonly root: string;
  readonly executable: string;
  readonly closureFingerprint: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly assertCurrent: () => Promise<void>;
}
const runtimes = new AsyncLocalStorage<GrGitRuntime>();
export function withGrGitRuntime<T>(runtime: GrGitRuntime, run: () => T): T {
  if (
    !path.isAbsolute(runtime.root) ||
    !path.isAbsolute(runtime.executable) ||
    !runtime.closureFingerprint
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Protected Git requires exact root, executable and admitted closure.",
    );
  const pinned = Object.freeze({ ...runtime, env: Object.freeze({ ...runtime.env }) });
  return runtimes.run(pinned, run);
}
const protectedOperationEnv = new Set(["RELIVERSE_GR_GIT_AUTHORITY", "GIT_GRAFT_FILE"]);

export type GrGitCommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export async function runGrGit(
  root: string,
  args: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly input?: string | undefined;
    readonly signal?: AbortSignal | undefined;
    /** Unprivileged public observations may opt out of ambient credentials/config. */
    readonly inheritEnv?: false;
  } = {},
): Promise<GrGitCommandResult> {
  if (options.signal?.aborted) {
    throw new GrError("GR_GIT_FAILED", "Git operation was cancelled before process start.");
  }
  const runtime = runtimes.getStore();
  if (runtime) {
    if (options.inheritEnv === false)
      throw new GrError(
        "GR_NOT_AUTHORIZED",
        "Protected Git cannot replace its admitted environment.",
      );
    if (path.resolve(root) !== path.resolve(runtime.root))
      throw new GrError("GR_NOT_AUTHORIZED", "Protected Git repository root changed.");
    if (
      Object.keys(options.env ?? {}).some(
        (key) =>
          !protectedOperationEnv.has(key) &&
          !(key === "GIT_INDEX_FILE" && isGrSnapshotIndex(root, options.env?.GIT_INDEX_FILE)) &&
          !(key === "GIT_EDITOR" && options.env?.GIT_EDITOR === "true"),
      )
    )
      throw new GrError(
        "GR_NOT_AUTHORIZED",
        "Protected Git refuses operation-supplied environment overrides.",
      );
    await runtime.assertCurrent();
    if (options.signal?.aborted)
      throw new GrError("GR_GIT_FAILED", "Git operation was cancelled before process start.");
  }
  return await new Promise<GrGitCommandResult>((resolve, reject) => {
    const child = spawn(
      runtime?.executable ?? "git",
      ["-c", "color.ui=false", "-c", "core.pager=cat", "-c", "core.quotepath=false", ...args],
      {
        cwd: root,
        env: {
          ...(runtime?.env ?? (options.inheritEnv === false ? {} : process.env)),
          GIT_EXTERNAL_DIFF: "",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          PAGER: "cat",
          ...options.env,
        },
        shell: false,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    let exceeded = false;

    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const append = (current: string, chunk: string): string => {
      const result = `${current}${chunk}`;
      if (Buffer.byteLength(result) > MAX_GIT_OUTPUT_BYTES) {
        exceeded = true;
        child.kill("SIGTERM");
        return result.slice(0, MAX_GIT_OUTPUT_BYTES);
      }
      return result;
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, stdoutDecoder.write(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, stderrDecoder.write(chunk));
    });
    child.once("error", (error) => {
      finishReject(new GrError("GR_GIT_FAILED", `Unable to start Git: ${error.message}`));
    });
    child.stdin?.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        finishReject(new GrError("GR_GIT_FAILED", `Unable to send input to Git: ${error.message}`));
      }
    });
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("close", (exitCode) => {
      stdout = append(stdout, stdoutDecoder.end());
      stderr = append(stderr, stderrDecoder.end());
      options.signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      if (exceeded) {
        reject(
          new GrError("GR_OUTPUT_LIMIT", `Git output exceeded ${MAX_GIT_OUTPUT_BYTES} bytes.`),
        );
        return;
      }
      if (options.signal?.aborted) {
        reject(new GrError("GR_GIT_FAILED", "Git operation was cancelled."));
        return;
      }
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
    if (options.input !== undefined) child.stdin?.end(options.input, "utf8");
  });
}

export async function runRequiredGrGit(
  root: string,
  args: readonly string[],
  options: Parameters<typeof runGrGit>[2] = {},
): Promise<string> {
  const result = await runGrGit(root, args, options);
  if (result.exitCode !== 0) {
    const reason = result.stderr
      .trim()
      .split(/\r?\n/u)
      .find((line) => line.trim().length > 0)
      ?.trim();
    throw new GrError(
      "GR_GIT_FAILED",
      reason
        ? `Git ${args[0] ?? "operation"} failed: ${reason}`
        : `Git ${args[0] ?? "operation"} failed.`,
      { args, exitCode: result.exitCode },
    );
  }
  return result.stdout;
}

export async function runOptionalGrGit(
  root: string,
  args: readonly string[],
  options: Parameters<typeof runGrGit>[2] = {},
): Promise<string | undefined> {
  const result = await runGrGit(root, args, options);
  return result.exitCode === 0 ? result.stdout : undefined;
}
