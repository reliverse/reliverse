# relpack

`relpack` is a modern archive helper for Rse/dev workflows: safe previews, archive manifests, verification, diffs, backups, rollback, and human-readable output.

## Direct CLI usage

`relpack` can run directly without the `rse` wrapper:

```bash
bun src/cli.ts doctor
bun src/cli.ts pack ./plugins/relpack -o relpack-0.1.3.zip --apply
bun src/cli.ts unpack './relpack-*.zip' -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --apply
bun src/cli.ts pack --help
```

When installed as a package with its bin linked, the same commands are available as:

```bash
relpack doctor
relpack pack ./plugins/relpack -o relpack-0.1.3.zip --apply
```

Wrapper mode remains supported:

```bash
rse relpack doctor
rse relpack pack ./plugins/relpack -o relpack-0.1.3.zip --apply
```

## Commands

```bash
rse relpack doctor
rse relpack pack <input...> -o <archive> [flags]
rse relpack unpack <archive> -o <dir> [flags]
rse relpack list <archive> [flags]
rse relpack test <archive> [flags]
rse relpack verify <archive> [flags]
rse relpack diff <archive> -o <dir> [flags]
rse relpack explain <command...>
```

Write commands are preview-first. Add `--apply` only after the preview looks correct.

## Safe plugin update example

```json
{
  "upd:relpack": "bun rse relpack unpack ./relpack-*.zip -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --post-check-command 'bun test plugins/relpack' --delete-archive --apply"
}
```

That flow:

1. selects the highest version-like `relpack-*.zip`,
2. backs up `./plugins/relpack`,
3. cleans the output directory,
4. extracts the archive,
5. runs the post-check,
6. rolls back on extraction/post-check failure,
7. deletes the source archive only after success.

## Packing

```bash
relpack pack ./plugins/relpack -o relpack-0.1.3.zip
relpack pack ./plugins/relpack -o relpack-0.1.3.zip --apply
rse relpack pack . -o repo.zip --show-skipped
```

By default, `pack` skips common junk/cache/secret names like `.git`, `node_modules`, `dist`, `.next`, `.turbo`, `.cache`, `coverage`, `tmp`, `logs`, `.env`, `.bun`, and more.

Useful flags:

```bash
--ignore name1,name2      # add extra ignored names
--include-ignored         # disable default ignored names intentionally
--show-skipped            # print skipped path examples
--no-manifest             # do not embed .relpack/manifest.json
--overwrite               # allow replacing an existing output archive
--apply                   # actually create the archive
```

## Manifest and verification

`pack` embeds a manifest by default:

```txt
.relpack/manifest.json
```

The manifest records package metadata when available, entry paths, sizes, and SHA-256 hashes for files.

```bash
rse relpack verify relpack-0.1.3.zip
rse relpack verify './relpack-*.zip' --json
```

## Listing

```bash
rse relpack list relpack-0.1.3.zip
rse relpack list relpack-0.1.3.zip --tree --max-depth 3
```

`list` now shows summary stats, important files, largest files when backend size data is available, manifest package/version, and next actions.

## Diff before unpacking

```bash
rse relpack diff relpack-0.1.3.zip -o ./plugins/relpack
```

`diff` compares archive contents with a target folder and reports:

- files the archive would add,
- files that changed,
- files present in output but removed from the archive.

When a manifest is present, relpack uses hashes for stronger comparisons.

## Unpacking safely

```bash
rse relpack unpack relpack-0.1.3.zip -o ./plugins/relpack
rse relpack unpack relpack-0.1.3.zip -o ./plugins/relpack --overwrite-mode files --apply
rse relpack unpack relpack-0.1.3.zip -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --apply
```

Overwrite modes:

```txt
never  # default; refuse existing destination files
files  # replace colliding files, do not delete output directory
clean  # delete explicit -o/--output directory before extraction
```

Backward-compatible shorthand:

```bash
--overwrite  # same as --overwrite-mode files
```

Extra safety flags:

```bash
--backup                # create sibling .relpack-backup-* before extraction
--rollback-on-fail      # requires --backup; restores output on extraction/post-check failure
--post-check-command    # shell command after extraction and before --delete-archive
--delete-archive        # delete source archive only after extraction and post-check success
--clean-output          # legacy/explicit alias for clean output behavior; prefer --overwrite-mode clean
```

`--clean-output` / `--overwrite-mode clean` refuses unsafe targets such as filesystem root, current working directory, home directory, paths outside the current workspace, files, symlinks, and outputs containing the source archive.

## Supported formats

```txt
tar, tar.gz, tgz, tar.zst, tzst, tar.xz, txz, tar.bz2, tbz2, zip, 7z
```

Actual support depends on installed system backends. Run:

```bash
rse relpack doctor
```

## Batch plugin updates

`relpack unpack` can update several local packages/plugins as one safe batch. Archive inputs are mapped to output directories in order; if your shell expands versioned globs, relpack groups package-like filenames and selects the highest version per group.

```bash
bun rse relpack unpack './rse-*.zip' './relpack-*.zip' \
  -o ./apps/rse ./plugins/relpack \
  --overwrite-mode clean \
  --backup \
  --rollback-on-fail \
  --post-check-command 'bun test apps/rse plugins/relpack' \
  --delete-archive \
  --apply
```

Batch safety behavior:

- `--post-check-command` runs once after every archive extracts.
- `--delete-archive` runs only after extraction and post-check both succeed.
- `--rollback-on-fail` restores all backed-up output directories if any extraction or post-check fails.
- `--overwrite-mode clean` requires explicit output directories and refuses unsafe cleanup targets.
