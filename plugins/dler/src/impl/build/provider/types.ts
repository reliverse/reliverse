export interface BuildTarget {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly displayCommand?: string | undefined;
  readonly label?: string | undefined;
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
