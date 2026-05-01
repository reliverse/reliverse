const CONTENT_EXPORT_PATTERN = /export\s+const\s+content\s*=\s*`/;

export function escapeContent(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

export function unescapeContent(content: string): string {
  return content.replace(/\\\${/g, "${").replace(/\\`/g, "`").replace(/\\\\/g, "\\");
}

export function createEscapedModuleContent(content: string): string {
  return `export const content = \`${escapeContent(content)}\`;\n`;
}

export function extractContentFromEscapedModule(moduleContent: string): string {
  const match = CONTENT_EXPORT_PATTERN.exec(moduleContent);

  if (!match) {
    throw new Error("Invalid escaped file format: expected `export const content = `...`;`.");
  }

  const contentStart = match.index + match[0].length;
  const contentEnd = findTemplateLiteralEnd(moduleContent, contentStart);

  if (contentEnd === -1) {
    throw new Error("Invalid escaped file format: could not find closing backtick.");
  }

  return moduleContent.slice(contentStart, contentEnd);
}

function findTemplateLiteralEnd(content: string, startIndex: number): number {
  for (let index = startIndex; index < content.length; index += 1) {
    if (content[index] !== "`") {
      continue;
    }

    if (!isEscapedAt(content, index)) {
      return index;
    }
  }

  return -1;
}

function isEscapedAt(content: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}
