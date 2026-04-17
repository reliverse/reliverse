# Rempts CLI Contract

## Runtime Tree

- Rempts derives its runtime tree from `entry`.
- It does not assume `src/` or `dist/` folder names.
- The tree that contains the executed `entry` must also ship the matching `cmds/` subtree.
- Host CLIs may also aggregate plugin-provided command trees, but local file-based commands remain a first-class source.

## Plugin Contract

- Plugins contribute command nodes through a stable manifest contract.
- Plugin command implementations must stay lazy-loadable.
- Plugin commands must participate in discovery, `--help`, execution, option parsing, and output conventions exactly like local commands.
- Command-path collisions between sources must fail fast instead of resolving silently.

## Help

- Root help is always available.
- Root help should stay layered: purpose, top-level commands, reserved globals, and a few first-step examples.
- Command help must include usage, options, aliases, examples, and relevant subcommands.
- `--help --json` must return a machine-readable help document.
- Nested command paths should expose subcommand help at each level.

## Automation-First Behavior

- Prefer flags, explicit stdin helpers, and defaults before prompts.
- Default host CLIs to non-interactive mode and require explicit opt-in for human-guided interaction.
- In non-TTY mode, prompts must fail fast instead of waiting for interaction.
- Error messages should tell the caller which flag or input path to use next.
- Commands must not silently consume stdin just because a value is missing.
- Source precedence is: flags, explicit stdin helpers, defaults, then prompts.

## Reserved Global Flags

- `--help`
- `--interactive`
- `--json`
- `--no-input`
- `--tui`

These are framework-reserved and must stay distinct from final-command flags.

## Command Conventions

- Prefer idempotent behavior where practical.
- Support `--dry-run` for commands with side effects.
- Support `--apply` when a command should switch from preview to real execution.
- Prefer clear flags such as `--overwrite` when the behavior is specifically about replacing existing outputs rather than applying a previewed plan.
- Default commands to `interactive: "never"` unless there is a strong reason to guide a human through a flow.
- Support `--yes` only when a command has a real confirmation path to bypass.
- Avoid hidden interactive requirements in automation and CI.
- Make stdin support explicit in help and examples.
- Include realistic examples that help both humans and agents reach the correct subcommand quickly.

## Output Conventions

- stdout is for primary command output.
- stderr is for diagnostics and failures.
- JSON-mode errors should expose a stable `kind`, `code`, `message`, and optional `issues`, `hint`, and `usage`.
- JSON-mode success should prefer `ctx.output.result(...)` so callers receive a stable result envelope.
- Dry runs should return a machine-followable preview of planned actions rather than prose alone.
