import path from "node:path";

import { BINARY_SAMPLE_BYTES } from "../constants";

const encoder = new TextEncoder();

export function getUtf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readTextFile(filePath: string): Promise<string> {
  return Bun.file(path.normalize(path.resolve(filePath))).text();
}

export async function looksBinary(filePath: string): Promise<boolean> {
  try {
    const absPath = path.normalize(path.resolve(filePath));
    const sample = new Uint8Array(
      await Bun.file(absPath).slice(0, BINARY_SAMPLE_BYTES).arrayBuffer(),
    );

    if (sample.length === 0) {
      return false;
    }

    for (const byte of sample) {
      if (byte === 0) {
        return true;
      }
    }

    const decoded = new TextDecoder("utf-8").decode(sample);
    let replacementChars = 0;

    for (const char of decoded) {
      if (char === "\uFFFD") {
        replacementChars += 1;
      }
    }

    return replacementChars >= 8 || replacementChars / Math.max(decoded.length, 1) > 0.01;
  } catch {
    return true;
  }
}
