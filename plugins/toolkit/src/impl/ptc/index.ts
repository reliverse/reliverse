import { createPtcConfig } from "./config";
import { runPtcPack } from "./pack";
import { formatPtcSummary } from "./summary";
import type { PtcOptions, PtcRunResult } from "./types";
import { runPtcUnpack } from "./unpack";

export type {
  CliConfig,
  CollectedFile,
  CollectResult,
  InputInfo,
  PtcOptions,
  PtcPackRunResult,
  PtcRunResult,
  PtcSummaryColors,
  PtcUnpackRunResult,
  SkippedFile,
  UnpackFile,
  UnpackResult,
} from "./types";

export { formatPtcSummary } from "./summary";

export async function runPtc(options: PtcOptions): Promise<PtcRunResult> {
  const config = createPtcConfig(options);

  if (config.unpack) {
    return runPtcUnpack(config);
  }

  return runPtcPack(config);
}
