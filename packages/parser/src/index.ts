export { toFlagName } from "./options/flag-name";
export type {
  BooleanOptionDefinition,
  CommandOptionDefinition,
  CommandOptionsOutput,
  CommandOptionsRecord,
  CommandOptionType,
  EmptyCommandOptions,
  NormalizedOptionIssue,
  NumberOptionDefinition,
  OptionInputSource,
  PrimitiveOptionValue,
  StringOptionDefinition,
} from "./options/types";
export { validateParsedOptions } from "./options/validate";
export {
  ParserError,
  type ParserErrorKind,
  type ParserStructuredError,
  ParserUsageError,
  ParserValidationError,
} from "./runtime/errors";
export { parseArgvTail, type ParseArgvResult } from "./runtime/parse-argv";
