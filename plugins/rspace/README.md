# `@reliverse/rspace-rse-plugin`

Portable workspace generator for Rse agents.

`rspace` creates a provider-agnostic “home” for an Rse agent: identity, instructions, memory, platform notes, imported source files, and machine-readable state.

> Rse should not belong to one platform.  
> Rse should have a portable home.

Works for workflows like Bleverse/ChatGPT, local CLI agents like `@reliverse/rse`/OpenClaw, and future runtimes.

> Note: `rspace` is the generator. `.rse/<team-name>/<agent-name>` is the workspace which `rspace` creates/modifies.

## What it generates

Example structure:

```txt
START_HERE.md
AGENTS.md
IDENTITY.md
TOOLS.md
MEMORY.md
ARCHIVE_MANIFEST.md
ARCHIVE_SHA256SUMS.txt

.rse/
  state.json
  platforms/
    generic.md
    chatgpt.md
    openclaw.md
    bleverse.md
  teams/
    <team-name>/
      <agent-name>/
        ...
```

Core files stay platform-neutral. Platform-specific guidance lives in .rse/platforms/.

Imported agent/source files live under .rse/teams/.

> Note: `@reliverse/rse` defaults to the `generic` platform.

## Usage examples

> Note: When `--input` points to an existing Rspace root, archive mode packs it directly instead of importing it as source.

Preview only:

```bash
rse rspace --name spock --output ./spock.rse
```

Create an empty Rspace:

```bash
rse rspace --name spock --output ./spock.rse --apply
```

Import source directory into a new Rspace:

```bash
rse rspace --input ~/.openclaw/teams/reliverse/spock --output ./spock.rse --apply
```

Create a `.tar.gz` archive:

```bash
rse rspace --input ./spock.rse --output /mnt/data/spock_rspace.tar.gz --archive --apply
```

Replace existing output:

```bash
rse rspace --input ./spock.rse --output /mnt/data/spock_rspace.tar.gz --archive --apply --overwrite
```

## Options

```txt
--input, -i              Input directory to import
--output, -o             Output directory or archive path
--name, -n               Rspace name
--platform               generic | chatgpt | openclaw | bleverse
--optimize-for-platform  Alias for --platform
--format                 dir | tar.gz
--archive                Alias for --format tar.gz
--apply                  Write files
--overwrite              Replace existing output
```

Without `--apply`, the command only previews the plan.

## Generated files

### `START_HERE.md`

First file your Rse agent should read. You can override the entry file name with `--entry-file`.

### `AGENTS.md`

Provider-neutral instructions for working with the Rspace.

### `IDENTITY.md`

Human-readable identity: agent name, protocol, platform, source info.

### `TOOLS.md`

Useful commands and workflow notes.

### `MEMORY.md`

Short durable notes. Not a chat transcript.

### `ARCHIVE_MANIFEST.md`

Human-readable summary of the Rspace.

### `ARCHIVE_SHA256SUMS.txt`

Checksums for generated protocol files.

### `.rse/state.json`

Machine-readable source of truth.

Agents should read this file when they need reliable state.

## Import behavior

When `--input` points to a directory, it is copied into:

```txt
.rse/teams/reliverse/<input-name>/
```

Example with `spock` as the input name:

```txt
.rse/teams/reliverse/spock/
```

## Generated vs imported files

Generated protocol files are owned by `rspace`:

- `START_HERE.md`
- `AGENTS.md`
- `IDENTITY.md`
- `TOOLS.md`
- `MEMORY.md`
- `ARCHIVE_MANIFEST.md`
- `ARCHIVE_SHA256SUMS.txt`
- `.rse/state.json`
- `.rse/platforms/*.md`

Imported files are copied under `.rse/teams/<team-name>/<agent-name>/`.

Agents may update imported files during a workflow, but should preserve protocol files unless the task explicitly changes the Rspace protocol.

## Ignored files

Rspace skips common heavy or sensitive files:

```txt
.git
node_modules
dist
build
coverage
.env
.env.*
.npmrc
.pnpmrc
*.key
*.pem
*.p12
*.pfx
```

## Platform notes

Platform guidance is stored here:

```txt
.rse/platforms/
  generic.md
  chatgpt.md
  openclaw.md
  bleverse.md
```

Use:

```bash
--platform chatgpt
--platform openclaw
--platform bleverse
```

The platform changes guidance, not the provider-neutral core.

## Agent workflow

If you are the agent, when you receive Rspace-based artifacts, do this:

1. Read `START_HERE.md`.
2. Read `AGENTS.md`.
3. Read `IDENTITY.md`.
4. Read `.rse/state.json`.
5. Read `MEMORY.md`.
6. Read relevant `.rse/platforms/*.md`.
7. Inspect `.rse/teams/reliverse/`.

Then continue the task and return an updated Rspace directory or archive.

## Design principles

- Provider-neutral first.
- Markdown for humans.
- JSON for tools and agents.
- No secrets.
- No full chat dumps.
- Compact memory.
- Explicit files over hidden runtime state.

## Current status

Early MVP. Structure may change.

Supported:

- directory output;
- `.tar.gz` output;
- directory import;
- platform notes;
- manifest generation;
- checksum generation;
- preview/apply mode.

Planned:

- inspect/verify modes;
- existing Rspace archive packing/import;
- packed text import/export;
- cumulative wave archives;
- `.rse/waves/`;
- safe restore/apply mode;
- zip support.

## License

MIT
