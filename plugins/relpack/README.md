# `@reliverse/relpack-rse-plugin`

Modern archive CLI for packing, unpacking, listing, testing, and explaining archive operations.

Relpack is intentionally adapter-based:

- current base: system adapters for `tar`, `zip`/`unzip`, and optional `7z`/`7zz`;
- future base: Rust core/binary adapter without changing the public CLI shape;
- long-term goal: safe, automation-friendly archive UX with only the most required features.

## Commands

```bash
rse relpack doctor
rse relpack pack ./dist -o dist.tar.zst
rse relpack pack ./dist -o dist.zip --format zip
rse relpack list dist.tar.zst
rse relpack test dist.zip
rse relpack unpack dist.tar.zst -o ./out
rse relpack explain pack ./dist -o dist.tar.zst --overwrite
```

## Supported base formats

| Format              | Pack | Unpack | List | Test | Backend                        |
| ------------------- | ---- | ------ | ---- | ---- | ------------------------------ |
| `.tar`              | Yes  | Yes    | Yes  | Yes  | `tar`                          |
| `.tar.gz`, `.tgz`   | Yes  | Yes    | Yes  | Yes  | `tar`                          |
| `.tar.zst`, `.tzst` | Yes  | Yes    | Yes  | Yes  | `tar --zstd` if available      |
| `.tar.xz`, `.txz`   | Yes  | Yes    | Yes  | Yes  | `tar -J`                       |
| `.tar.bz2`, `.tbz2` | Yes  | Yes    | Yes  | Yes  | `tar -j`                       |
| `.zip`              | Yes  | Yes    | Yes  | Yes  | `zip` + `unzip`                |
| `.7z`               | Yes  | Yes    | Yes  | Yes  | optional `7zz`, `7z`, or `7za` |

## Safety defaults

Relpack defaults to conservative filesystem behavior:

- refuses path traversal entries like `../../file`;
- refuses absolute archive paths;
- refuses Windows reserved device names inside archive entries;
- refuses extraction collisions unless `--overwrite` is provided;
- refuses to create an output archive that already exists unless `--overwrite` is provided;
- supports `--dry-run` and `--json` for automation.

## Usage

```bash
bun i -g @reliverse/rse
bun i -g @reliverse/relpack-rse-plugin
rse relpack doctor
```

## Rust core direction

See [`docs/rust-core-roadmap.md`](./docs/rust-core-roadmap.md).
