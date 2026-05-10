export interface BuildCommandInvocation {
  readonly argv: readonly string[];
  readonly bundleStrategy?: "single" | "split" | undefined;
  readonly display: string;
}
