# `@reliverse/toolkit-rse-plugin`

Utility commands for CLIs built with `@reliverse/rempts`.

This plugin provides small, automation-friendly tools.

> Battle-tested with `@reliverse/rse`, but compatible with any Rempts-based CLI that allows this plugin package pattern, such as `"@reliverse/*-rse-plugin"` in `createCLI(...).plugins.allowedPatterns`.

## Purpose

`@reliverse/toolkit-rse-plugin` is the home for general-purpose CLI utilities that do not belong to one specific package, framework, or product area.

The commands in this plugin are designed to be:

- explicit by default
- safe for automation
- friendly to dry-runs and previews
- easy to compose with scripts, agents, and shell workflows

## Commands

### `rse escape`

Escape text for safer use in CLI, scripting, and copy/paste workflows.

Use this command when you need to transform raw text into an escaped form before passing it into another command, prompt, script, or generated file.

```sh
rse escape --help
```

### `rse ptc`

Pack project text files into one deterministic `.txt` context file, or unpack a patched packed context back into files.

`ptc` stands for **Packed Text Context**.

It is useful when you want to:

- prepare a focused project context file for an AI assistant
- pack selected source files into a reviewable text artifact
- send context somewhere, receive a patched version back, and unpack it
- keep file-writing operations explicit via `--apply`
- prevent accidental full-repo packing unless `--allow-dot` is used

```sh
rse ptc packages/rempts -o rempts-context.txt
rse ptc packages/rempts -o rempts-context.txt --apply
rse ptc packages/rempts -o rempts-context.txt --overwrite --apply
```

Pack the current project root intentionally:

```sh
rse ptc . -o monorepo-context.txt --allow-dot
```

Limit included file types:

```sh
rse ptc packages/rempts -o rempts-context.txt --ext ts,tsx,json,md
```

Add extra ignored names:

```sh
rse ptc packages/rempts -o rempts-context.txt --ignore tmp,logs
```

Limit file size:

```sh
rse ptc packages/rempts -o rempts-context.txt --max-size 500kb
```

Unpack a patched context file back into the original project tree:

```sh
rse ptc rempts-context.patched.txt --unpack --overwrite --apply
```

Unpack while explicitly passing the original project root:

```sh
rse ptc rempts-context.patched.txt --unpack -o /home/blefnk/dev/reliverse/reliverse --overwrite --apply
```

## Safety model

Commands in this plugin prefer preview-first behavior when they may write files.

For file-writing commands:

- use `--apply` to actually write files
- use `--overwrite` when replacing existing files is intentional
- preview output before applying large or destructive changes
- avoid packing `.` unless you intentionally pass `--allow-dot`

This keeps the plugin safer for both humans and automation agents.

## `ptc` behavior

By default, `rse ptc` only includes known safe text file types and skips common generated or dependency directories.

Common ignored names include:

- `.git`
- `node_modules`
- `dist`
- `build`
- `.next`
- `.cache`
- `coverage`
- temporary/log folders

Large files are skipped by default. The default max size is `1mb`.

Hidden paths inside walked directories are skipped unless `--include-hidden` is passed.

## Recommended workflow for AI patching

1. Pack the relevant project files:

   ```sh
   rse ptc packages/example -o example-context.txt --apply
   ```

2. Send `example-context.txt` to an assistant or review tool.

3. Save the returned patched file as something like:

   ```txt
   example-context.patched.txt
   ```

4. Preview unpacking:

   ```sh
   rse ptc example-context.patched.txt --unpack
   ```

5. Apply unpacking intentionally:

   ```sh
   rse ptc example-context.patched.txt --unpack --overwrite --apply
   ```

## Notes

- Built on the Rempts file-based plugin model.
- Designed for explicit, scriptable developer workflows.
- Uses preview-first behavior for write operations.
- Uses `--overwrite` only when replacing existing generated outputs is intentional.
- `ptc` stores project-root metadata to make unpacking safer.
- Commands should remain small, composable, and predictable.

## Related docs

- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
- Rse CLI docs: [`../../apps/rse/README.md`](../../apps/rse/README.md)
