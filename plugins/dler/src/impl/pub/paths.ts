import { resolve } from "node:path";

/** Reject absolute paths and `..` segments (publish-from is relative to each package root). */
export function isSafeRelativePublishFrom(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return false;
  }

  const parts = trimmed.split(/[/\\]/);
  if (parts.some((segment) => segment === "..")) {
    return false;
  }

  const resolved = resolve("/fake-root", trimmed);
  if (!resolved.startsWith("/fake-root")) {
    return false;
  }

  return true;
}
