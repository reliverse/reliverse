import { spawn } from "node:child_process";

import type { CommandContext, ProcessResult } from "./types";

export interface RunProcessOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ProcessBufferResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const result = await runProcessBuffer(command, args, options);
  return {
    command: result.command,
    args: result.args,
    exitCode: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr,
  };
}

export async function runProcessBuffer(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessBufferResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        command,
        args,
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

export async function canRun(command: string, ctx: CommandContext): Promise<boolean> {
  try {
    const result = await runProcess(command, ["--version"], { cwd: ctx.cwd, env: ctx.env });
    return (
      result.exitCode === 0 ||
      result.exitCode === 1 ||
      result.stdout.length > 0 ||
      result.stderr.length > 0
    );
  } catch {
    return false;
  }
}

export async function findExecutable(
  names: readonly string[],
  ctx: CommandContext,
): Promise<string | undefined> {
  for (const name of names) {
    if (await canRun(name, ctx)) return name;
  }
  return undefined;
}

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}
