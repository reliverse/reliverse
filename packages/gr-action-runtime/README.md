# @reliverse/gr-action-runtime

Actor-neutral Action Plane adapter for GR-owned repository mutations.

The v0 adapter intentionally reuses the already-reviewed bounded patch parser/check/apply machinery from `@reliverse/workspace-runtime`; it does not create a second patch implementation. GR owns the repository operation identity and receipt projection, while the Git-backed low-level adapter remains an implementation detail during convergence.
