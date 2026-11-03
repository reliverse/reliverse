/**
 * An explicit DCS configuration profile name. Profiles are selected by a host
 * or CLI flag; DCS never infers one from environment variables or host names.
 */
export type DcsProfileName = string;

export const DCS_PROFILE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export function isDcsProfileName(value: string): value is DcsProfileName {
  return DCS_PROFILE_NAME_PATTERN.test(value);
}

export function assertDcsProfileName(value: string): DcsProfileName {
  if (!isDcsProfileName(value)) {
    throw new TypeError(
      `DCS profile name must use lower-case ASCII letters, digits, and single hyphens; received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}
