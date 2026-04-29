import { defineCommand } from "@reliverse/rempts";

import { formatPtcSummary, runPtc } from "./impl/impl";

export default defineCommand({
  meta: {
    name: "ptc",
    description: "Pack your project text files into one deterministic `.txt` context file.",
  },
  agent: {
    notes: "Use --apply when you need command to actually write the output file.",
  },
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write"],
  },
  help: {
    examples: [
      "rse ptc . -o project-context.txt",
      "rse ptc . -o project-context.txt --apply",
      "rse ptc . -o project-context.txt --ext ts,tsx,json,md",
      "rse ptc . -o project-context.txt --ignore tmp,logs",
      "rse ptc . -o project-context.txt --max-size 500kb",
    ],
    text: "Pack your project text files into one deterministic `.txt` context file.",
  },
  options: {
    output: {
      type: "string",
      short: "o",
      defaultValue: "packed-context.txt",
      description: "Output file path",
      inputSources: ["flag", "default"],
    },
    ext: {
      type: "string",
      description: "Comma-separated exact extension allowlist, replacing defaults",
      inputSources: ["flag"],
    },
    extMerge: {
      type: "string",
      description: "Comma-separated extension allowlist merged into defaults",
      inputSources: ["flag"],
    },
    ignore: {
      type: "string",
      description: "Comma-separated names to ignore in addition to defaults",
      inputSources: ["flag"],
    },
    maxSize: {
      type: "string",
      defaultValue: "1mb",
      description: "Maximum file size to include, e.g. 500kb, 1mb, 2000b, or unlimited",
      inputSources: ["flag", "default"],
    },
    includeHidden: {
      type: "boolean",
      description: "Include hidden paths inside walked directories",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      if (ctx.safety.apply) {
        ctx.safety.assertApplied("fs.write");
      }

      const run = await runPtc({
        inputPaths: ctx.args as string[],
        outputPath: ctx.options.output,
        apply: ctx.safety.apply,
        ext: ctx.options.ext,
        extMerge: ctx.options.extMerge,
        ignore: ctx.options.ignore,
        maxSize: ctx.options.maxSize,
        includeHidden: ctx.options.includeHidden === true,
      });

      ctx.out(formatPtcSummary(run));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.exit(1, message);
    }
  },
});
