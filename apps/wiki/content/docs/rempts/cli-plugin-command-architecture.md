# Rempts CLI / Plugin / Command Architecture Spec v1

## Goal

Define how Rempts composes a CLI from:

- CLI-level runtime policy
- optional plugin discovery
- plugin-provided command trees
- command-level implementations
- inherited option scopes
- diagnostics/debug surfaces

This spec describes the current architecture plus the next intended extension for inherited options across CLI, plugin, and command scopes.

---

## 1. Core model

A Rempts-based CLI is assembled from three primary layers:

1. **CLI layer**
   - created by `createCLI(...)`
   - owns runtime policy, output mode, interaction policy, plugin discovery policy, and top-level help behavior

2. **Plugin layer**
   - created by `definePlugin(...)`
   - contributes a command subtree plus plugin metadata and, in the proposed Wave 1 model, plugin-level inherited options

3. **Command layer**
   - created by `defineCommand(...)`
   - defines the actual command handler, command-local help, command-local options, and command behavior

A command invocation is always resolved against a single effective host CLI session.

By default, Rempts debug tooling should inspect the **current host CLI session**, not some other CLI chosen implicitly.

---

## 2. Current public architecture

## 2.1 `createCLI(...)`

`createCLI(...)` is the host bootstrap API.

It currently owns:

- entry resolution
- CLI metadata
- launcher help rendering
- global flag parsing
- interaction policy
- plugin discovery policy
- plugin loading
- command discovery
- command help rendering
- command execution
- diagnostics injection into `CommandContext`

Important plugin-discovery design rules:

- plugins are **optional**
- enabling plugin discovery must **not** force at least one plugin to exist
- empty discovery must fall back to normal CLI help
- plugin activation is controlled by the **host environment / end user**, while the CLI defines which package names are allowed

Supported plugin-discovery policy shape:

```ts
createCLI({
  plugins: {
    allowedPatterns: ["@reliverse/*-rse-plugin"],
    conflictPriority: ["@reliverse/rempts-rse-plugin", "@reliverse/*-rse-plugin"],
  },
});
```

Breaking redesign decisions already baked in:

- `plugins.explicit` was removed
- `plugins.supportPlugins` was removed
- supported discovery model is policy-based via `plugins.allowedPatterns`

## 2.2 `definePlugin(...)`

`definePlugin(...)` currently defines plugin identity and contract metadata.

Current public fields include:

- `apiVersion`
- `name`
- `entry`
- `description?`
- `capabilities?`
- `provides?`

Plugin API is versioned through:

```ts
REMPTS_PLUGIN_API_VERSION;
```

Unsupported plugin versions must fail with `RemptsUsageError`.

Plugins are technically portable across any Rempts-based CLI that:

- uses `@reliverse/rempts`
- enables plugin discovery
- allows the package via `plugins.allowedPatterns`
- has the package available in local/global resolution context

So package naming may be CLI-branded, but compatibility is not inherently limited to one host CLI.

## 2.3 `defineCommand(...)`

`defineCommand(...)` defines:

- command metadata
- help text/examples
- command-local options
- interaction mode
- handler

Today, command options are the only non-global option scope implemented in the public command API.

---

## 3. Runtime flags vs inherited options

Rempts must keep these concepts separate.

## 3.1 Runtime global flags

These are true CLI-runtime controls.

Examples:

- `--help`
- `--json`
- `--interactive`
- `--tui`
- `--no-input`

Properties:

- parsed before command dispatch
- owned by `createCLI(...)`
- reserved across the entire CLI
- affect runtime behavior, not domain semantics

Example:

```bash
rse --json rempts plugins list
```

This is already a valid and production-ready model.

## 3.2 Inherited options

These are not runtime-global flags.
They are user/domain-facing options whose definitions can come from different scopes and flow down to the final command.

Examples:

- `--cli`
- `--global`
- `--profile`
- `--workspace`

These should be modeled as **inherited options**, not as another flavor of global flag.

That distinction keeps the term “global flag” clean and avoids confusing users.

---

## 4. Proposed inherited-option architecture

This is the intended Wave 1 direction.

## 4.1 Three option scopes

Introduce three mergable option-definition scopes:

1. **CLI-level options**
   - defined in `createCLI(...)`
   - inherited by all commands, including plugin commands

2. **Plugin-level options**
   - defined in `definePlugin(...)`
   - inherited by all commands owned by that plugin

3. **Command-level options**
   - defined in `defineCommand(...)`
   - apply only to the concrete command

## 4.2 Precedence

Effective option-definition precedence must be:

```txt
command options > plugin options > cli options
```

If multiple scopes define the same option key:

- command-level definition wins over plugin-level definition
- plugin-level definition wins over CLI-level definition

The lower scope fully replaces the higher-scope definition for that key.

No partial definition merge.

## 4.3 Effective option schema

For a resolved command, Rempts should build the effective option schema by merging scopes in this order:

```txt
merge(cli.options, plugin.options, command.options)
```

Then parse argv **once** using the merged schema.

This avoids layered parsing complexity and yields one final `ctx.options` object.

## 4.4 Command examples

This enables patterns like:

```bash
rse rempts plugins list --cli rse --global
rse rempts commands doctor --cli @reliverse/rse --global
```

where:

- `--cli`
- `--global`

can be defined at plugin scope in `@reliverse/rempts-rse-plugin` and inherited automatically by all commands in that plugin subtree.

---

## 5. Why plugin-level options exist

Plugin-level options solve a real modeling gap.

Without them, shared options for a plugin namespace must be duplicated in every leaf command.

That leads to:

- duplicated option definitions
- drift in descriptions/defaults/validation
- less consistent help output
- weaker mental model for users

Plugin-level inherited options let a plugin define shared semantics once and apply them consistently to all its commands.

This is especially valuable for diagnostic/inspection plugins whose commands all target the same conceptual subject.

---

## 6. Why CLI-level inherited options also matter

CLI-level inherited options are distinct from runtime global flags.

They are useful for shared CLI semantics that should reach every command, including commands coming from plugins.

Examples:

- workspace selection
- profile selection
- target environment
- organization/account selection

These should not be implemented as ad hoc repeated command options across the tree.

---

## 7. Help and JSON requirements for inherited options

When effective options are merged, help output must remain understandable.

## 7.1 Text help

Text help should ideally show source provenance per option, for example:

- `[cli]`
- `[plugin]`
- `[command]`

This is not strictly required for the first internal implementation, but it is the desired direction.

## 7.2 JSON help

JSON help should expose enough metadata for agents and tools to understand:

- effective option key
- option definition
- source scope
- source owner (`cli name`, `plugin name`, or `command path`)
- whether the option overrides a broader-scope option

This is important for explainability and tooling.

---

## 8. Conflict model for commands vs options

## 8.1 Command conflicts

Exact-node command conflicts between plugins are resolved through explicit policy:

```ts
plugins.conflictPriority;
```

Rules:

- applies only to **exact-node conflicts**
- supports exact package override
- supports glob/pattern priority
- first matching rule wins
- deeper unique subcommands may still merge into the tree

This is a command-source precedence mechanism, not an option-definition mechanism.

## 8.2 Option conflicts

Inherited-option conflicts use scope precedence:

```txt
command > plugin > cli
```

These should not reuse `plugins.conflictPriority`.

The two systems solve different problems.

---

## 9. Diagnostics architecture

Rempts already has structured diagnostics and should keep leaning into that.

Important runtime reports include:

- `PluginDiscoveryReport`
- `CommandTreeReport`

These should continue to explain:

- which plugins were loaded
- which packages were ignored by policy
- which plugins were rejected and why
- which command node won exact-node conflicts
- which commands were shadowed
- where subcommands merged
- why precedence selected the winner

The rempts debug plugin should default to **self-introspection** of the current host CLI session.

Cross-CLI inspection is desirable, but it should be explicit and never the default hidden mode.

---

## 10. Cross-CLI inspection direction

Desired behavior:

- default: inspect the currently running host CLI
- explicit cross-CLI mode: inspect another CLI by package name or bin name

Examples:

```bash
rse rempts plugins list
rse rempts commands doctor
```

Default meaning:

- inspect the active `rse` host session

Future explicit target mode may look like:

```bash
rse rempts plugins list --cli rse --global
rse rempts commands doctor --cli @reliverse/rse --global
```

where target resolution may support:

- package name
- bin name
- local resolution
- global resolution
- explicit `--global` / `--no-global`

This should be modeled through inherited options, not through a new “plugin-global flags” abstraction.

---

## 11. Wave 1 implementation scope

Wave 1 should implement the minimum clean version of inherited options.

## 11.1 Required API additions

### `createCLI(...)`

Add optional inherited option definitions:

```ts
createCLI({
  options: {
    // inherited by all commands
  },
});
```

### `definePlugin(...)`

Add optional inherited option definitions:

```ts
definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  name: "rempts-rse-plugin",
  entry: import.meta.url,
  options: {
    cli: { type: "string" },
    global: { type: "boolean" },
  },
});
```

### `defineCommand(...)`

No conceptual change beyond command-local precedence over inherited scopes.

## 11.2 Required runtime behavior

For the resolved command:

1. gather CLI-level inherited options
2. gather plugin-level inherited options for the owning plugin, if any
3. gather command-local options
4. merge by precedence
5. parse once
6. expose final result through `ctx.options`

## 11.3 Required guardrails

- runtime global flags remain a separate system
- inherited options must not collide with reserved global flags
- lower scope fully overrides higher scope on matching option key
- help/json should remain stable and understandable

---

## 12. Non-goals for Wave 1

Wave 1 does not need to solve everything.

Not required in the first pass:

- fancy per-option provenance formatting in text help
- full explain UI for option inheritance
- cross-CLI execution of arbitrary foreign commands
- namespace-level parser rewrites beyond what inherited options require
- reuse of the term “global flags” for inherited plugin/CLI options

---

## 13. Summary

Rempts should use a clean layered architecture:

- **runtime global flags** for host/runtime controls
- **CLI-level inherited options** for whole-CLI semantics
- **plugin-level inherited options** for plugin-wide semantics
- **command-level options** for leaf-command specifics

With the following precedence:

```txt
command > plugin > cli
```

And with command conflict resolution kept separate through:

```txt
plugins.conflictPriority
```

This preserves a clean mental model, avoids duplication, improves diagnostics, and gives plugin namespaces a natural way to define shared options without pretending they are “global flags”.
