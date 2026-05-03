import type {
  ArchiveEntry,
  ArchiveFormat,
  CommandContext,
  ListRequest,
  PackRequest,
  ProcessResult,
  TestRequest,
  UnpackRequest,
} from "../types";

export interface ArchiveAdapter {
  readonly id: string;
  readonly formats: readonly ArchiveFormat[];
  readonly canPack: boolean;
  readonly canUnpack: boolean;
  readonly canList: boolean;
  readonly canTest: boolean;
  isAvailable(ctx: CommandContext): Promise<boolean>;
  list(request: ListRequest, ctx: CommandContext): Promise<readonly ArchiveEntry[]>;
  pack?(request: PackRequest, ctx: CommandContext): Promise<ProcessResult>;
  unpack?(request: UnpackRequest, ctx: CommandContext): Promise<ProcessResult>;
  test?(request: TestRequest, ctx: CommandContext): Promise<ProcessResult>;
}
