# Agent Guidelines

## Information

- **Runtime**: Convex w/ Typescript
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Convex schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)
- **New features**: Read and understand `ARCHITECTURE.md` before implementing new modules or features

## Available Commands

- **Build**: `bun run build`
- **Dev**: `bun run dev`
- **Typecheck**: `bun run typecheck`
- **Test**: `bun run test`
- **Format**: `bun run format` - Checking only
- **Format Fix**: `bun run format:fix` - Writing formatting changes
- **Lint**: `bun run lint` - Checking only
- **Lint Fix**: `bun run lint:fix` - Writing linting changes
- **Clean**: `bun run clean` - Clean cache & modules
