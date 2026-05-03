# Relpack Rust core roadmap

## Phase 0: TypeScript system backend

Current scaffold:

- `tar` adapter for `.tar`, `.tar.gz`, `.tar.zst`, `.tar.xz`, `.tar.bz2`;
- `zip` adapter using `zip` and `unzip`;
- optional `7z` adapter using `7zz`, `7z`, or `7za`;
- shared safety layer for paths, overwrite policy, and diagnostics.

## Phase 1: Rust binary backend

Add a separate Rust binary, for example:

```txt
crates/
  relpack-core/
    Cargo.toml
    src/main.rs
```

Expose stable JSON I/O:

```bash
relpack-core pack --request request.json
relpack-core unpack --request request.json
relpack-core list --request request.json
relpack-core test --request request.json
```

Then add a TypeScript adapter that calls this binary when available.

## Phase 2: Rust library candidates

Good initial candidates:

- `tar` for TAR archive read/write;
- `zip` for ZIP archive read/write;
- `sevenz-rust2` for native `.7z` support;
- `flate2` for gzip/deflate;
- `zstd` for Zstandard;
- `xz2` or a pure Rust LZMA/XZ path after audit;
- `bzip2` for bzip2;
- optional `libarchive2` compatibility backend for unusual read/extract formats.

## Phase 3: Production hardening

Before calling the Rust backend production-ready:

- add fuzzing for archive parsing and path normalization;
- build a malicious archive corpus;
- verify Windows path behavior;
- verify Unicode normalization edge cases;
- test large files and zip/tar bombs;
- document extraction policy for symlinks and hardlinks;
- add deterministic archive output mode.
