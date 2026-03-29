import type { HelpDocument } from "./help-model";

export interface StructuredHelpDocument extends HelpDocument {
  readonly ok: true;
  readonly remptsHelp: 1;
  readonly schemaVersion: 1;
}

export function serializeHelpDocument(document: HelpDocument): StructuredHelpDocument {
  return {
    ...document,
    ok: true,
    remptsHelp: 1,
    schemaVersion: 1,
  };
}
