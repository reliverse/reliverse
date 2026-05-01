import type { EscapeAction, EscapeSummary } from "./types";

export function buildEscapeSummary(actions: readonly EscapeAction[]): EscapeSummary {
  let blocked = 0;
  let noop = 0;
  let planned = 0;
  let written = 0;

  for (const action of actions) {
    if (action.action === "blocked") {
      blocked += 1;
      continue;
    }

    if (action.action === "noop") {
      noop += 1;
      continue;
    }

    if (action.action === "planned") {
      planned += 1;
      continue;
    }

    if (action.action === "written") {
      written += 1;
    }
  }

  return {
    actions: [...actions],
    blocked,
    noop,
    planned,
    total: actions.length,
    written,
  };
}