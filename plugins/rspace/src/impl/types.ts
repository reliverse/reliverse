export type RspacePlatform = "generic" | "chatgpt" | "openclaw" | "bleverse";

export type RspaceFormat = "dir" | "tar.gz";

export type RspaceInputKind = "none" | "directory";

export type RspaceArtifactKind = "directory" | "tar.gz";

export type RspaceCreateOptions = {
  input?: string;
  output: string;
  name: string;
  team?: string;
  customPath?: string;
  entryFile: string;
  platform: RspacePlatform;
  overwrite: boolean;
  apply: boolean;
};

export type RspacePackOptions = {
  input: string;
  output: string;
  overwrite: boolean;
  apply: boolean;
};

export type RspaceVerifyOptions = {
  input: string;
};

export type RspaceImportedSource = {
  kind: RspaceInputKind;
  name?: string;
  originalPath?: string;
  targetPath?: string;
  team?: string;
  customPath?: string;
  fileCount: number;
};

export type RspaceState = {
  protocol: "rspace-v1";
  kind: "rse-agent-space";
  name: string;
  team?: string;
  entryFile: string;
  platform: RspacePlatform;
  optimizedFor: RspacePlatform[];
  createdBy: "@reliverse/rspace-rse-plugin";
  createdAt: string;
  updatedAt: string;
  source: RspaceImportedSource;
  files: string[];
  generatedFiles: string[];
};

export type RspaceCreatePlan = {
  options: RspaceCreateOptions;
  workspacePath: string;
  source: RspaceImportedSource;
  generatedFiles: Map<string, string>;
};

export type RspaceCommandContext = {
  cwd?: string | (() => string);
  args?: Record<string, unknown>;
  argv?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  options?: Record<string, unknown>;
  values?: Record<string, unknown>;
  parsed?: {
    args?: Record<string, unknown>;
    options?: Record<string, unknown>;
    values?: Record<string, unknown>;
  };
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
};

export type RspaceToolCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type RspaceVerificationResult = {
  input: string;
  kind: RspaceArtifactKind;
  ok: boolean;
  files: string[];
  warnings: string[];
};
