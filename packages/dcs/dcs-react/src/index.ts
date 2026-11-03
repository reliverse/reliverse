/**
 * Browser-neutral React source code generation for DCS contracts.
 *
 * This package intentionally emits TSX source without importing React itself.
 * Generated applications own their React runtime and their chosen UI kit.
 */
export {
  DCS_REACT_UI_CODEGEN_VERSION,
  generateDcsReactUi,
  isDcsUiPreset,
  normalizeDcsUiPreset,
  type DcsReactGeneratedFile,
  type DcsReactUiGeneration,
  type DcsReactUiGenerateOptions,
  type DcsUiCssFramework,
  type DcsUiFramework,
  type DcsUiPreset,
} from "./generate";
