import { defineCommand } from "@reliverse/rempts";

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/\r?\n/).length;
}

function buildPreview(text: string, maxLength = 120): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

export default defineCommand({
  name: "input",
  description: "Read explicit text or piped stdin and return a machine-followable summary",
  agent: {
    notes:
      "Prefer --text for direct automation or --stdin when the command is part of a pipeline. This command never prompts for missing input.",
  },
  conventions: {
    acceptsStdin: ["flag", "stdin"],
    idempotent: true,
  },
  examples: [
    'rse input --text "hello rempts"',
    'printf "hello\\nworld" | rse input --stdin',
    'printf \'{"name":"reliverse"}\' | rse input --stdin --format json --trim',
  ],
  help:
    "Source precedence is explicit: use --text first, or pass --stdin to intentionally consume piped input.",
  options: {
    format: {
      type: "string",
      defaultValue: "text",
      description: "Interpret the input payload as plain text or JSON",
      hint: 'Use "json" when piping structured data that should be parsed.',
      inputSources: ["flag", "default"],
    },
    stdin: {
      type: "boolean",
      description: "Read from stdin explicitly instead of using --text",
      hint: "This flag prevents hidden stdin reads and keeps automation explicit.",
      inputSources: ["flag"],
    },
    text: {
      type: "string",
      description: "Direct text input without using stdin",
      hint: "Use this for one-shot automation where piping would add unnecessary ceremony.",
      inputSources: ["flag"],
    },
    trim: {
      type: "boolean",
      description: "Trim leading and trailing whitespace after reading the input",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const shouldReadStdin = ctx.options.stdin === true;
    const requestedFormat = (ctx.options.format ?? "text").toLowerCase();
    const source = shouldReadStdin ? "stdin" : "flag";

    let rawText: string | undefined;

    if (shouldReadStdin) {
      rawText = await ctx.input.text();
    } else if (ctx.options.text) {
      rawText = ctx.options.text;
    }

    const resolvedText =
      rawText ?? ctx.exit(1, 'Missing input. Pass --text "..." or pipe content with --stdin.');
    const text = ctx.options.trim ? resolvedText.trim() : resolvedText;
    const summary = {
      byteLength: Buffer.byteLength(text, "utf8"),
      format: requestedFormat,
      lineCount: countLines(text),
      preview: buildPreview(text),
      source,
      trimmed: ctx.options.trim === true,
    };

    if (requestedFormat === "json") {
      try {
        const parsed = JSON.parse(text) as unknown;

        if (ctx.output.mode === "json") {
          ctx.output.result(
            {
              ...summary,
              parsed,
            },
            "input",
          );
          return;
        }

        ctx.out(`Source: ${summary.source}`);
        ctx.out(`Bytes: ${summary.byteLength}`);
        ctx.out(`Lines: ${summary.lineCount}`);
        ctx.out("Parsed JSON successfully.");
        return;
      } catch {
        ctx.exit(
          1,
          'Input is not valid JSON. Re-run with valid JSON or omit `--format json`.',
        );
      }
    }

    if (ctx.output.mode === "json") {
      ctx.output.result(summary, "input");
      return;
    }

    ctx.out(`Source: ${summary.source}`);
    ctx.out(`Bytes: ${summary.byteLength}`);
    ctx.out(`Lines: ${summary.lineCount}`);
    ctx.out(`Preview: ${summary.preview}`);
  },
});
