---
title: "ptc (pack text context)"
description: "Pack project text files into one deterministic `.txt` context file."
---

`ptc` is a command of the toolkit-rse-plugin. It allow you to pack your project's text files into one deterministic `.txt` context file.

## Purpose

`ptc` scans one or more input files/directories, includes only safe text files, and can write their content into a single LLM-friendly `.txt` context file.

It is useful when you need to prepare compact project/code context for AI prompts, reviews, debugging, or documentation snapshots.

## Requirements

- Bun
- TypeScript support through Bun

No additional dependencies are required.

## Safety-first behavior

By default, the script runs in **summary-only** mode.

That means it will:

- resolve input paths;
- scan directories;
- apply ignore/extension/max-size/binary filters;
- show what would be included/skipped;
- show warnings and recommendations;
- show the resolved output path;
- not create the output file;
- not create the output directory;
- not open a writer;
- not read full file contents.

To actually write the output file, pass `--apply`.

## Usage

```bash
rse ptc <input-path...> -o <output-file>
```

Summary-only example:

```bash
rse ptc ./src -o src-context.txt
```

Apply example:

```bash
rse ptc ./src -o src-context.txt --apply
```

Multiple input paths:

```bash
rse ptc ./apps/omp/gamemodes/systems/attachment ./apps/omp/gamemodes/systems/prop apps/omp/gamemodes/systems/action -o attachment-system-context.txt --ext pwn --apply
```

More examples:

```bash
rse ptc . -o project-context.txt
rse ptc . -o project-context.txt --apply
rse ptc . -o project-context.txt --ext ts,tsx,json,md --apply
rse ptc . -o project-context.txt --ignore tmp,logs --max-size 500kb --apply
rse ptc package.json -o package-context.txt --apply
```

If `-o` / `--output` is not provided, the script uses:

```txt
packed-context.txt
```

## Path semantics

Relative input and output paths are resolved from the current working directory.

So these are equivalent:

```bash
rse ptc apps/omp/gamemodes/systems/action -o attachment-system-context.txt
rse ptc ./apps/omp/gamemodes/systems/action -o ./attachment-system-context.txt
```

`./` means the directory where you run the command from, not the directory where the script file lives.

## Multiple inputs

The script supports multiple positional input paths.

Each input path can be:

- a file;
- a directory;
- missing;
- unsupported.

Directory inputs are scanned recursively.

File inputs are processed as a single file.

Overlapping inputs are deduplicated by absolute normalized path. For example:

```bash
rse ptc ./src ./src/utils -o context.txt
```

Files from `./src/utils` will not be included twice. The summary will show a warning/recommendation about overlapping inputs.

For multiple inputs, output file blocks use input labels to avoid ambiguity.

## Options

### `--apply`

Actually writes the output file.

Without `--apply`, the script only prints a summary.

```bash
rse ptc ./src -o src-context.txt --apply
```

### `-o`, `--output`

Sets the output file path.

```bash
rse ptc ./src -o src-context.txt
rse ptc ./src --output src-context.txt
rse ptc ./src --output=src-context.txt
```

If the output value starts with `-`, use inline form:

```bash
rse ptc ./src --output=-context.txt
```

### `--ext`

Processes **only** the provided safe text extensions.

```bash
rse ptc . -o context.txt --ext ts,tsx,json,md
rse ptc . -o pawn-context.txt --ext pwn
```

`--ext pwn` means only `.pwn` files.

`--ext ts,tsx,md` means only `.ts`, `.tsx`, and `.md` files.

It does not merge with defaults.

When `--ext` is used, special extensionless filenames like `Dockerfile`, `README`, and `LICENSE` are not included.

Unsupported or binary extensions fail clearly:

```bash
rse ptc . -o context.txt --ext ts,png,md
```

`.png` is rejected because it is not a supported text extension.

Extension values are case-insensitive. Both `pwn` and `.pwn` mean `.pwn`.

### `--ext-merge`

Uses default text detection and merges extra supported extensions into it.

```bash
rse ptc . -o context.txt --ext-merge pwn,inc
```

This mode keeps default text extensions and special extensionless filenames.

Unsupported or binary extensions are still rejected.

### `--ignore`

Adds extra ignored file or folder names.

```bash
rse ptc . -o context.txt --ignore tmp,logs,snapshots
rse ptc . -o context.txt --ignore=tmp,logs,snapshots
```

Ignore matching works by file/folder name, not only by full path.

### `--max-size`

Sets the maximum size per included file.

Default:

```txt
1mb
```

Supported units:

```txt
b
kb
kib
mb
mib
gb
gib
```

Examples:

```bash
rse ptc . -o context.txt --max-size 500kb
rse ptc . -o context.txt --max-size 2mb
rse ptc . -o context.txt --max-size 2000b
rse ptc . -o context.txt --max-size=500kb
```

Disable the limit:

```bash
rse ptc . -o context.txt --max-size unlimited
```

### `--include-hidden`

Includes hidden files and folders during directory traversal.

```bash
rse ptc . -o context.txt --include-hidden
```

By default, hidden paths are skipped during directory traversal.

Explicit hidden input files can still be processed:

```bash
rse ptc .env -o env-context.txt
```

## Included text files

By default, the script includes files with these extensions:

```txt
.ts
.tsx
.js
.jsx
.mjs
.cjs
.mts
.cts
.json
.jsonc
.md
.mdx
.txt
.sh
.bash
.zsh
.ini
.env
.example
.yaml
.yml
.toml
.css
.scss
.html
.xml
.sql
.gitignore
.dockerignore
.editorconfig
.inc
.pwn
```

It also supports these special extensionless text filenames when `--ext` is not used:

```txt
Dockerfile
Containerfile
Makefile
Procfile
LICENSE
NOTICE
README
CHANGELOG
CONTRIBUTING
```

Special filename matching is case-insensitive.

## Default ignored names

The script skips common generated, dependency, cache, and build directories/files by default:

```txt
.git
.hg
.svn
.DS_Store
.idea
.vscode
.history
node_modules
bower_components
vendor
dist
build
out
.next
.nuxt
.svelte-kit
.astro
.turbo
.vercel
.output
.cache
.parcel-cache
coverage
.nyc_output
.vitest
.pytest_cache
__pycache__
tmp
temp
logs
log
.pnpm-store
.yarn
.bun
```

## Binary detection

The script does not rely only on extensions.

Even if a file has an allowed text extension, it is skipped when it appears to contain binary content.

Binary detection checks a small sample of the first bytes and skips files with:

- null bytes;
- too many UTF-8 replacement characters.

In summary-only mode, the script may read these small binary-detection samples, but it does not read full file contents.

## Symlinks

Symlinks are skipped.

This avoids accidental traversal outside the expected project tree.

## Output file safety

The script validates output paths before writing.

It fails when:

- the output path already exists and is a directory;
- the output path is the same as one of the explicit input files.

If an input path is a directory and the output file is inside it, this is allowed. The output file is skipped during collection.

If the output file already exists:

- summary-only mode shows a warning and does not change it;
- apply mode overwrites it and clearly reports that it was overwritten.

Parent directories for the output file are created only in apply mode.

## Output format

The generated file starts with:

```txt
# Packed Text Context
```

Then it contains:

```txt
## Summary
## Inputs
## Warnings
## Recommendations
## Included Files
## Skipped Files
## Content
```

Each included file is written as a block:

```txt
================================================================================
FILE: path/to/file.ts
INPUT: input-label
SIZE: 1234 bytes
================================================================================
<file content>
```

For multiple inputs, file paths are prefixed with input labels where needed to avoid ambiguity.

## Console output

The console output always shows the current mode:

```txt
Mode: summary-only
```

or:

```txt
Mode: apply
```

Summary output includes:

```txt
Input count: <count>
Output file: <absolute-output-path>
Included files: <count>
Skipped files: <count>
Total included bytes: <bytes>
Inputs:
  1. <input-path> · type=<type> · status=<status> · included=<count> · skipped=<count>
     resolved=<absolute-input-path>
```

In apply mode, it also prints:

```txt
Bytes written: <bytes>
Output action: written
```

or:

```txt
Output action: overwritten
```

## Input statuses

Each input can have one of these types:

```txt
file
directory
missing
unsupported
```

Each input can have one of these statuses:

```txt
ok
failed
```

Apply mode aborts if one or more input paths failed.

## Skipped reasons

Skipped files can have these reasons:

```txt
hidden path
ignored name
output file
symlink
extension not allowed
larger than max size
binary content
cannot read metadata
cannot read directory
unsupported file type
missing input
duplicate file from overlapping input
```

## Deterministic output

Files are sorted by display path before writing.

Skipped files are sorted by display path and reason.

This keeps output stable between runs when file contents do not change.

## Context for AI agents

Preview a full project snapshot without writing anything:

```bash
rse ptc . -o project-context.txt
```

Actually write a full project snapshot:

```bash
rse ptc . -o project-context.txt --apply
```

Source-only context:

```bash
rse ptc ./src -o src-context.txt --apply
```

TypeScript + Markdown context:

```bash
rse ptc . -o ts-md-context.txt --ext ts,tsx,md,mdx,json --apply
```

Pawn-only context:

```bash
rse ptc ./apps/omp -o pawn-context.txt --ext pwn --apply
```

Multiple specific systems:

```bash
rse ptc ./apps/omp/gamemodes/systems/attachment ./apps/omp/gamemodes/systems/prop apps/omp/gamemodes/systems/action -o attachment-system-context.txt --ext pwn --apply
```

Larger project with big files excluded:

```bash
rse ptc . -o project-context.txt --max-size 500kb --apply
```
