export function toFlagName(optionName: string): string {
  return optionName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
