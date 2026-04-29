# Rempts Interaction Model Spec v1

## Goal

Make `rempts` automation-first by default.

Interactive behavior, including plain terminal prompts and TUI prompts, must be:

- explicit
- predictable
- opt-in
- overridable by the host CLI
- easy to understand for both humans and agents

The default path must optimize for:

- agents
- CI
- scripts
- programmatic callers

## 1. Design principles

### 1.1 Automation-first default

If nothing explicit is configured, commands must run in non-interactive mode.

### 1.2 Explicit over implicit

Do not infer "human mode" only from the presence of a TTY.

TTY availability is a capability, not consent.

### 1.3 Host policy beats environment capability

The CLI host decides whether interaction is allowed at all.

Environment only determines whether the requested interactive surface is possible.

### 1.4 Command policy is narrower than host policy

A command may be stricter than the host.
A command must not be more permissive than the host.

### 1.5 `--no-input` is absolute

If `--no-input` is set, all prompting is disabled, regardless of host mode, command mode, or TTY/TUI availability.

## 2. New public API

### 2.1 Command-level interaction policy

Add to `CommandConfig`:

```ts
type RemptsInteractionMode = "never" | "tty" | "tui";

interface CommandConfig<TOptions extends CommandOptionsRecord = EmptyCommandOptions> {
  ...
  readonly interactive?: RemptsInteractionMode | undefined;
  ...
}
```

#### Meaning

- `"never"`
  - no prompts
  - no TUI
  - command must rely on flags, stdin, defaults, or fail-fast behavior

- `"tty"`
  - plain terminal prompts allowed
  - TUI not allowed

- `"tui"`
  - TUI allowed
  - plain TTY prompt fallback allowed if TUI backend is unavailable

### 2.2 Default command interaction policy

If `interactive` is omitted:

```ts
interactive = "never";
```

This is the critical behavioral default.

### 2.3 Host-level interaction policy

Add to `CreateCLIOptions`:

```ts
type RemptsHostInteractionMode = "never" | "tty" | "tui" | "auto";
```

```ts
interface CreateCLIOptions {
  ...
  readonly interactionMode?: RemptsHostInteractionMode | undefined;
  ...
}
```

#### Meaning

- `"never"`
  - host forbids all prompting
- `"tty"`
  - host allows only plain terminal prompts
- `"tui"`
  - host allows TUI and TTY fallback
- `"auto"`
  - legacy/human-friendly mode
  - host may allow interaction based on environment capability

### 2.4 Default host interaction policy

Default:

```ts
interactionMode = "never";
```

For `rse`, explicitly set:

```ts
interactionMode: "never";
```

## 3. Reserved global flags

Add new reserved global flags:

- `--interactive`
- `--tui`

### 3.1 Semantics

#### `--interactive`

Requests host interaction mode `tty`.

#### `--tui`

Requests host interaction mode `tui`.

If both are present:

- `--tui` wins

If `--no-input` is present:

- `--no-input` wins over both

### 3.2 Scope

These are global host flags, not command flags.

They must be parsed before command dispatch.

## 4. Effective interaction resolution

Introduce effective interaction resolution with this precedence:

### 4.1 Inputs

The runtime must consider:

- host configured `interactionMode`
- reserved global flags (`--interactive`, `--tui`, `--no-input`)
- command `interactive`
- environment capability
- CI state

### 4.2 Resolution algorithm

#### Step 1. Resolve requested host mode

Start from `createCLI({ interactionMode })`.

Then apply global flags:

- `--interactive` -> requested host mode becomes `"tty"`
- `--tui` -> requested host mode becomes `"tui"`
- `--no-input` -> final effective mode becomes `"never"`

#### Step 2. Resolve command mode

Use command `interactive`, default `"never"`.

#### Step 3. Intersect host mode and command mode

Effective allowed mode is the stricter of the two.

Rules:

| host  | command | effective                                 |
| ----- | ------- | ----------------------------------------- |
| never | never   | never                                     |
| never | tty     | never                                     |
| never | tui     | never                                     |
| tty   | never   | never                                     |
| tty   | tty     | tty                                       |
| tty   | tui     | tty                                       |
| tui   | never   | never                                     |
| tui   | tty     | tty                                       |
| tui   | tui     | tui                                       |
| auto  | never   | never                                     |
| auto  | tty     | tty if env allows                         |
| auto  | tui     | tui if env allows, else tty if env allows |

#### Step 4. Apply environment restrictions

If:

- `CI=true`, or
- stdin/stdout is not TTY

then effective mode becomes `"never"`.

#### Step 5. Produce runtime fields

Runtime should expose:

```ts
interface InteractionPolicy {
  readonly requestedHostMode: "never" | "tty" | "tui" | "auto";
  readonly commandMode: "never" | "tty" | "tui";
  readonly effectiveMode: "never" | "tty" | "tui";
  readonly canPrompt: boolean;
  readonly isTTY: boolean;
  readonly isTUIAllowed: boolean;
  readonly isNonInteractive: boolean;
  readonly reason: string;
  readonly stdinMode: "tty" | "pipe";
}
```

## 5. Prompt behavior rules

### 5.1 `interactive: "never"`

Any prompt attempt must fail fast with a structured error.

Suggested message:

```txt
Prompt "<name>" is unavailable because this command is configured for non-interactive execution. Supply the value via flags, stdin, or defaults.
```

### 5.2 `interactive: "tty"`

Plain terminal prompts may be used only if:

- effective mode is `tty` or `tui`
- environment supports TTY
- `--no-input` is not set
- not CI

### 5.3 `interactive: "tui"`

TUI may be used only if:

- effective mode is `tui`
- TUI backend is available
- environment supports TTY
- `--no-input` is not set
- not CI

If TUI backend is unavailable:

- fallback to plain TTY prompt behavior

## 6. Backward compatibility and migration

### 6.1 Deprecate `noTTY` and `noTUI`

Current fields:

- `noTTY`
- `noTUI`

should be deprecated.

They should remain supported temporarily as compatibility inputs.

### 6.2 Compatibility mapping

During migration:

- `noTTY: true` -> `interactive = "never"`
- `noTUI: true` with `noTTY !== true` -> `interactive = "tty"`
- neither set -> if `interactive` omitted, default to `"never"` in new behavior

If both legacy and new fields are present:

- new `interactive` field wins

### 6.3 Docs policy

All docs must stop recommending `noTTY` / `noTUI` for new commands.

New docs must use `interactive`.

## 7. Help and metadata

### 7.1 Help JSON

Replace any old TTY/TUI convention exposure with:

```ts
interactive?: "never" | "tty" | "tui"
```

in the help document / JSON output.

### 7.2 Human-readable help

When relevant, command help may include a note:

- `Interactive mode: disabled by default`
- `Supports plain interactive prompts when --interactive is passed`
- `Supports TUI when --tui is passed`

## 8. `rse` host policy

### 8.1 Default

`apps/cli/src/cli.ts` must set:

```ts
interactionMode: "never";
```

### 8.2 Rationale

`rse` is a developer automation CLI and should be optimized for:

- agents
- scripts
- CI
- deterministic command execution

### 8.3 Human opt-in

Humans may request:

```bash
rse --interactive ...
rse --tui ...
```

But commands still obey their own narrower command-level policy.

## 9. Plugin command policy guidance

### 9.1 Default for most commands

For most commands in `pm`, `dler`, `tools`, and many `os` flows:

```ts
interactive: "never";
```

### 9.2 Commands that may use TTY prompts

Use:

```ts
interactive: "tty";
```

only when:

- the command has a real human-guided value collection flow
- and prompt UX materially improves clarity

### 9.3 Commands that may use TUI

Use:

```ts
interactive: "tui";
```

only when:

- TUI materially improves the workflow
- the command is still safe without TUI
- the command has a sensible fallback

## 10. Error behavior

### 10.1 Missing required values in non-interactive mode

Commands must fail fast and tell the caller what to pass.

Example:

```txt
Missing target. Pass --target <path>.
```

Not:

```txt
Let me ask you interactively...
```

### 10.2 Prompt denied by policy

Return structured errors with a stable code, e.g.:

```txt
REMPTS_INTERACTION_DISABLED
REMPTS_TTY_DISABLED
REMPTS_TUI_DISABLED
```

## 11. Testing matrix

Add tests for:

### 11.1 Default behavior

- no host interaction mode specified
- no command interaction specified
- TTY exists
- result: non-interactive

### 11.2 Host opt-in

- host `"tty"` + command `"tty"` + TTY env -> prompt allowed
- host `"tui"` + command `"tui"` + TTY env -> TUI allowed
- host `"tui"` + command `"tty"` -> TTY only

### 11.3 Command strictness

- host `"tui"` + command `"never"` -> no interaction
- host `"tty"` + command `"never"` -> no interaction

### 11.4 Environment restrictions

- CI -> no interaction
- pipe stdin/stdout -> no interaction
- `--no-input` -> no interaction

### 11.5 Fallback behavior

- host `"tui"` + command `"tui"` + no TUI backend -> TTY fallback

### 11.6 Legacy compatibility

- `noTTY: true` maps correctly
- `noTUI: true` maps correctly
- `interactive` overrides legacy fields

## 12. Documentation changes required

Update:

- `packages/rempts/README.md`
- `packages/rempts/docs/cli-contract.md`
- `apps/cli/README.md`

New docs must explicitly state:

> Rempts is automation-first by default. Interactive prompts and TUI are opt-in.

## 13. Recommended migration order

### Phase A

- add new types and runtime support for `interactive`
- add host `interactionMode`
- add reserved global flags

### Phase B

- make new defaults active
- keep compatibility with `noTTY` / `noTUI`

### Phase C

- migrate `rse`
- migrate plugins
- update docs

### Phase D

- deprecate legacy fields in docs
- optionally log internal warnings in development

## 14. Example target API

### Command

```ts
export default defineCommand({
  interactive: "never",
  options: { ... },
  async handler(ctx) { ... },
});
```

### Human-guided command

```ts
export default defineCommand({
  interactive: "tty",
  async handler(ctx) { ... },
});
```

### Host CLI

```ts
await createCLI({
  entry: import.meta.url,
  interactionMode: "never",
});
```

### Human opt-in

```bash
rse --interactive some command
rse --tui some command
```

## tl;dr

- default non-interactive
- host-controlled
- command-bounded
- human interactivity only by explicit opt-in
- TTY availability is not consent
