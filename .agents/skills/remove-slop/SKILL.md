---
name: remove-slop
description: Remove AI code slop from the codebase.
license: MIT
---

# Remove AI Code Slop

- Scan the codebase and remove clear artifacts of AI-generated or AI-overassisted code.
- Act conservatively. Modify only what is unmistakably slop.

## Remove

- Narrative, tutorial, or explanatory comments
- Comments that restate code behavior
- Redundant guards, defensive checks, or try/catch in trusted paths
- Type escapes (`any`, unsafe forced casts) and unnecessary generics
- `unknown` unless strictly required at boundaries
- Over-engineered patterns without local precedent
- Naming, structure, or formatting inconsistent with adjacent files

## Keep

- Existing local conventions and implicit assumptions
- Direct, minimal implementations
- Working TypeScript inference
- Unusual or complex code that shows consistent human intent

## Do Not

- Add abstractions, helpers, or layers
- Introduce new patterns, safety, or best practices
- Reformat unrelated code
- Change behavior or semantics

## Heuristic

- If the change does not clearly remove AI slop, do not apply it.
- When in doubt, leave the code untouched.

## Output

- Finish with a 1-3 sentence summary describing only what was removed.
- Output nothing else.
