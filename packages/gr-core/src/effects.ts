import { GrError } from "./error";
import type { GrEffectKind } from "./model";

export function assertGrEffects(
  required: readonly GrEffectKind[],
  granted: readonly GrEffectKind[] | undefined,
): void {
  const grants = new Set(granted ?? []);
  for (const effect of required) {
    if (!grants.has(effect)) {
      throw new GrError(
        "GR_NOT_AUTHORIZED",
        `GR operation requires the undeclared grant ${effect}.`,
        { effect },
      );
    }
  }
}
