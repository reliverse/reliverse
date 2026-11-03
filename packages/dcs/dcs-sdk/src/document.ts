/**
 * JSON document semantics live in @reliverse/dcs-contract because resolvers in
 * Rust, Go, Python, or TypeScript must read the same envelope and reset model.
 * This module preserves the public @reliverse/dcs import surface.
 */
export {
  parseConfigDocument,
  type ConfigDocumentScope,
  type DcsCollectionMove,
  type DcsDocumentSyntax,
  type ParseConfigDocumentOptions,
  type ParseConfigDocumentResult,
  type ParsedConfigDocument,
  type PersistentConfigScope,
} from "@reliverse/dcs-contract";
