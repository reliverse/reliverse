export type PtcOptions = {
  inputPaths: string[];
  outputPath?: string | undefined;
  apply?: boolean | undefined;
  unpack?: boolean | undefined;
  overwrite?: boolean | undefined;
  ext?: string | string[] | undefined;
  extMerge?: string | string[] | undefined;
  ignore?: string | string[] | undefined;
  maxSize?: string | number | undefined;
  includeHidden?: boolean | undefined;
};

export type ExtMode = "default" | "exact" | "merge";

export type InputType = "file" | "directory" | "missing" | "unsupported";

export type InputStatus = "ok" | "failed";

export type CliConfig = {
  inputPaths: string[];
  outputPath: string | undefined;
  apply: boolean;
  unpack: boolean;
  overwrite: boolean;
  allowedExts: ReadonlySet<string>;
  allowedTextFileNames: ReadonlySet<string>;
  ignoredNames: ReadonlySet<string>;
  maxSizeBytes: number;
  includeHidden: boolean;
  extMode: ExtMode;
};

export type InputInfo = {
  index: number;
  userPath: string;
  absPath: string;
  label: string;
  type: InputType;
  status: InputStatus;
  error: string | null;
  includedCount: number;
  skippedCount: number;
};

export type CollectedFile = {
  absPath: string;
  relPath: string;
  displayPath: string;
  inputIndex: number;
  inputLabel: string;
  sizeBytes: number;
};

export type SkippedFile = {
  absPath: string | null;
  relPath: string;
  displayPath: string;
  inputIndex: number;
  inputLabel: string;
  reason: string;
};

export type CollectResult = {
  inputs: InputInfo[];
  included: CollectedFile[];
  skipped: SkippedFile[];
  warnings: string[];
  recommendations: string[];
  outputAbsPath: string;
  hasMultipleInputs: boolean;
};

export type CollectState = {
  included: CollectedFile[];
  skipped: SkippedFile[];
  seenFiles: Set<string>;
  outputAbsPath: string;
  hasMultipleInputs: boolean;
};

export type OutputInfo = {
  exists: boolean;
  isFile: boolean;
};

export type PackedInputRoot = {
  index: number;
  label: string;
  resolvedPath: string;
  relativeRoot: string;
  type: InputType;
};

export type PackedBlockHeader = {
  index: number;
  contentStart: number;
  filePath: string;
  inputLabel: string;
  sizeBytes: number;
};

export type UnpackFile = {
  packedPath: string;
  relativeTargetPath: string;
  targetAbsPath: string;
  inputLabel: string;
  expectedSizeBytes: number;
  contentBytes: number;
  content: string;
  exists: boolean;
  action: "write" | "overwrite";
  skippedReason: string | null;
};

export type UnpackResult = {
  inputAbsPath: string;
  packedProjectRoot: string;
  baseAbsPath: string;
  baseProvidedBy: "cwd" | "output";
  inputRoots: PackedInputRoot[];
  files: UnpackFile[];
  warnings: string[];
  recommendations: string[];
};

export type PtcPackRunResult = {
  mode: "pack";
  config: CliConfig;
  result: CollectResult;
  outputInfo: OutputInfo;
  bytesWritten?: number | undefined;
};

export type PtcUnpackRunResult = {
  mode: "unpack";
  config: CliConfig;
  unpack: UnpackResult;
  bytesWritten?: number | undefined;
};

export type PtcRunResult = PtcPackRunResult | PtcUnpackRunResult;

export type PtcSummaryColors = {
  heading: (text: string) => string;
  key: (text: string) => string;
  value: (text: string) => string;
  info: (text: string) => string;
  warning: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
};

export type OutputWriter = {
  write: (chunk: string) => Promise<void>;
  end: () => Promise<void>;
  bytesWritten: () => number;
};

export type SizeUnit = "b" | "kb" | "kib" | "mb" | "mib" | "gb" | "gib";
