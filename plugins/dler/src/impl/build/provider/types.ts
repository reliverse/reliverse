export interface BuildTarget {
  readonly cwd: string;
  readonly label?: string | undefined;
  readonly script?: string | undefined;
}

export interface BuildTargetResult {
  readonly cwd: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly label: string;
  readonly ok: boolean;
  readonly provider: string;
  readonly stderr: string;
  readonly stdout: string;
}

export interface BuildReport {
  readonly ok: boolean;
  readonly provider: string;
  readonly targets: readonly BuildTargetResult[];
  readonly totalDurationMs: number;
}

export interface BuildProvider {
  readonly id: string;
  buildTarget(target: BuildTarget): Promise<BuildTargetResult>;
}
