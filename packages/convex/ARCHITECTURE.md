# Convex Backend Architecture

This document outlines the current architecture patterns and conventions for the Convex backend.

## Directory Structure

```
packages/backend/src/
├── _generated/              # Auto-generated types (never edit)
│   ├── api.d.ts
│   ├── api.js
│   ├── dataModel.d.ts
│   ├── server.d.ts
│   └── server.js
│
├── schema.ts                # Root schema (imports from tables/)
│
├── tables/                  # Table definitions
│   └── tasks.ts
│
├── modules/                 # Feature-based organization
│   └── task/
│       ├── queries.ts       # Public query handlers
│       └── mutations.ts     # Public mutation handlers
│
└── lib/                     # Shared utilities across modules
    ├── middleware.ts        # Zod-wrapped query/mutation/action builders
    ├── errors.ts            # DatabaseError enum and helpers
    ├── logger.ts            # Structured logger
    └── env.ts               # Environment variables
```

## Core Patterns

### Path Aliases

Always use the `@repo/backend/*` path alias for imports:

```typescript
// Good
import { Id } from "@repo/backend/_generated/dataModel";
import { QueryCtx } from "@repo/backend/_generated/server";
import { DatabaseError, dbError } from "@repo/backend/lib/errors";

// Avoid
import { DatabaseError } from "../../lib/errors";
```

### Table Definitions

Tables are defined in `/tables` using `zodvex` for validation:

```typescript
// packages/backend/src/tables/tasks.ts
import { z } from "zod";
import { zodTable } from "zodvex";

export const Tasks = zodTable("tasks", {
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.number(),
});
```

The root schema imports and combines all tables:

```typescript
// packages/backend/src/schema.ts
import { defineSchema } from "convex/server";

import { Tasks } from "./tables/tasks";

export default defineSchema({
  tasks: Tasks.table,
});
```

#### Adding Indexes

Add indexes to tables in the schema:

```typescript
// packages/backend/src/schema.ts
export default defineSchema({
  tasks: Tasks.table.index("by_completed", ["completed"]).index("by_created", ["createdAt"]),
});
```

### Middleware

The `lib/middleware.ts` file exports Zod-wrapped versions of Convex's `query`, `mutation`, and `action` builders using `zodvex`:

```typescript
// packages/backend/src/lib/middleware.ts
import { zActionBuilder, zMutationBuilder, zQueryBuilder } from "zodvex";

import {
  action as convexAction,
  mutation as convexMutation,
  query as convexQuery,
} from "@repo/backend/_generated/server";

export const query = zQueryBuilder(convexQuery);
export const mutation = zMutationBuilder(convexMutation);
export const action = zActionBuilder(convexAction);
```

**When to use middleware vs raw Convex:**

| Use Case                             | Import From                       |
| ------------------------------------ | --------------------------------- |
| Public functions with Zod validators | `@repo/backend/lib/middleware`    |
| Functions with Convex validators     | `@repo/backend/_generated/server` |

### Current Handler Pattern

Handlers are currently simple and direct, using Convex's built-in validators:

```typescript
// packages/backend/src/modules/task/queries.ts
import { query } from "@repo/backend/_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").order("desc").collect();
  },
});
```

```typescript
// packages/backend/src/modules/task/mutations.ts
import { v } from "convex/values";

import { mutation } from "@repo/backend/_generated/server";

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", {
      text: args.text,
      completed: false,
      createdAt: Date.now(),
    });
  },
});

export const toggle = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error("Task not found");

    await ctx.db.patch(args.id, {
      completed: !task.completed,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
```

### Error Handling

The error system provides a base error type and helpers for type-safe error checking:

```typescript
// packages/backend/src/lib/errors.ts
export type BaseError<Code extends string = string> = {
  code: Code;
  message?: string;
  cause?: unknown;
};

export function isError<T extends string>(
  error: BaseError<string>,
  code: T,
): error is BaseError<T> {
  return error.code === code;
}

export function isOneOf<T extends string>(
  error: BaseError<string>,
  codes: readonly T[],
): error is BaseError<T> {
  return codes.includes(error.code as T);
}
```

Common database errors are pre-defined:

```typescript
export enum DatabaseErrorCode {
  QUERY_FAILED = "QUERY_FAILED",
  INSERT_FAILED = "INSERT_FAILED",
  UPDATE_FAILED = "UPDATE_FAILED",
  DELETE_FAILED = "DELETE_FAILED",
  NOT_FOUND = "NOT_FOUND",
}

export type DatabaseError = BaseError<DatabaseErrorCode>;

export const dbError = {
  queryFailed: (cause?: unknown): DatabaseError => ({
    code: DatabaseErrorCode.QUERY_FAILED,
    message: "Database query failed",
    cause,
  }),
  // ... other error factories
};
```

### Logging

A simple structured logger is available for consistent logging:

```typescript
import { logger } from "@repo/backend/lib/logger";

logger.info("Task created", { taskId: "123" });
logger.error("Failed to create task", { error: err.message });
logger.warn("Task not found", { taskId: args.id });
logger.debug("Processing task", { task });
```

Log level is controlled via the `LOG_LEVEL` environment variable (defaults to "debug").

### Environment Variables

Environment variables are validated using `@repo/env` and ArkType:

```typescript
// packages/backend/src/lib/env.ts
import { createEnv, defaulted } from "@repo/env";
import { type } from "arktype";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    LOG_LEVEL: defaulted(type("'debug' | 'info' | 'warn' | 'error'"), "debug"),
  },
});
```

## API Paths

File structure maps directly to API paths:

| File                        | Export   | API Path                            |
| --------------------------- | -------- | ----------------------------------- |
| `modules/task/queries.ts`   | `list`   | `api.modules.task.queries.list`     |
| `modules/task/mutations.ts` | `create` | `api.modules.task.mutations.create` |
| `modules/task/mutations.ts` | `toggle` | `api.modules.task.mutations.toggle` |
| `modules/task/mutations.ts` | `remove` | `api.modules.task.mutations.remove` |

## Frontend Usage

Import and use the generated API:

```typescript
import { useMutation, useQuery } from "convex/react"

import { api } from "@repo/backend/_generated/api"

export function TaskList() {
  const tasks = useQuery(api.modules.task.queries.list)
  const createTask = useMutation(api.modules.task.mutations.create)
  const toggleTask = useMutation(api.modules.task.mutations.toggle)
  const removeTask = useMutation(api.modules.task.mutations.remove)

  return (
    <div>
      {tasks?.map((task) => (
        <div key={task._id}>
          <span>{task.text}</span>
          <button onClick={() => toggleTask({ id: task._id })}>
            {task.completed ? "Undo" : "Complete"}
          </button>
          <button onClick={() => removeTask({ id: task._id })}>Delete</button>
        </div>
      ))}
    </div>
  )
}
```

## Adding a New Module

1. **Create the table definition** in `/tables/[name].ts`:

   ```typescript
   import { z } from "zod";
   import { zodTable } from "zodvex";

   export const Users = zodTable("users", {
     name: z.string(),
     email: z.string().email(),
     createdAt: z.number(),
   });
   ```

2. **Add table to schema.ts**:

   ```typescript
   import { Users } from "./tables/users";

   export default defineSchema({
     tasks: Tasks.table,
     users: Users.table,
   });
   ```

3. **Create module folder** `/modules/[name]/`

4. **Create handlers** as needed:
   - `queries.ts` - For reading data
   - `mutations.ts` - For writing data
   - `actions.ts` - For external API calls or complex operations

## Scaling Patterns

As the application grows, consider these patterns:

### Using Zod Validators

For richer validation and frontend sharing, use Zod validators via middleware:

```typescript
// packages/backend/src/modules/task/mutations.ts
import { z } from "zod";

import { mutation } from "@repo/backend/lib/middleware";

const createTaskInput = z.object({
  text: z.string().min(1).max(500),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export const create = mutation({
  args: createTaskInput,
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", {
      text: args.text,
      priority: args.priority ?? "medium",
      completed: false,
      createdAt: Date.now(),
    });
  },
});
```

### Separating Validators for Frontend Sharing

Create a `validators.ts` file to share schemas with frontend:

```typescript
// packages/backend/src/modules/task/validators.ts
import { z } from "zod";

export const createTaskInput = z.object({
  text: z.string().min(1).max(500),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskInput>;
```

Frontend usage with react-hook-form:

```typescript
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import type { CreateTaskInput } from "@repo/backend/modules/task/validators";
import { createTaskInput } from "@repo/backend/modules/task/validators";

const form = useForm<CreateTaskInput>({
  resolver: zodResolver(createTaskInput),
});
```

### Services Layer with Result Types

For complex business logic, create a services layer that returns `Result<T, E>` using neverthrow:

```typescript
// packages/backend/src/modules/task/services/mutations.ts
import { err, fromPromise, ok, Result } from "neverthrow";

import type { MutationCtx } from "@repo/backend/_generated/server";
import { DatabaseError, dbError } from "@repo/backend/lib/errors";

export async function create(
  ctx: MutationCtx,
  args: { text: string },
): Promise<Result<string, DatabaseError>> {
  if (args.text.length > 500) {
    return err(dbError.insertFailed("Text too long"));
  }

  return await fromPromise(
    ctx.db.insert("tasks", {
      text: args.text,
      completed: false,
      createdAt: Date.now(),
    }),
    dbError.insertFailed,
  );
}
```

Handler unwraps the Result:

```typescript
// packages/backend/src/modules/task/mutations.ts
import { v } from "convex/values";

import { mutation } from "@repo/backend/_generated/server";
import { logger } from "@repo/backend/lib/logger";

import * as TaskServices from "./services/mutations";

export const create = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const result = await TaskServices.create(ctx, args);

    if (result.isErr()) {
      logger.error("Failed to create task", { error: result.error });
      throw new Error("Failed to create task");
    }

    logger.info("Task created", { taskId: result.value });
    return result.value;
  },
});
```

### Internal Functions

For cron jobs or internal operations, create internal functions:

```typescript
// packages/backend/src/modules/task/internal_mutations.ts
import { v } from "convex/values";

import { internalMutation } from "@repo/backend/_generated/server";

export const cleanup = internalMutation({
  args: { olderThanDays: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const staleTasks = await ctx.db
      .query("tasks")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .collect();

    for (const task of staleTasks) {
      await ctx.db.delete(task._id);
    }

    return staleTasks.length;
  },
});
```

### Authenticated Middleware

For protected routes, extend the context with user data:

```typescript
// packages/backend/src/lib/middleware.ts
import type { ExtractCtx } from "zodvex";
import { customCtx, zCustomMutationBuilder, zCustomQueryBuilder } from "zodvex";

import type { Doc } from "@repo/backend/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@repo/backend/_generated/server";
import { mutation as convexMutation, query as convexQuery } from "@repo/backend/_generated/server";

export const authQuery = zCustomQueryBuilder(
  convexQuery,
  customCtx(async (ctx: QueryCtx): Promise<{ user: Doc<"users"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) throw new Error("User not found");
    return { user };
  }),
);

export const authMutation = zCustomMutationBuilder(
  convexMutation,
  customCtx(async (ctx: MutationCtx): Promise<{ user: Doc<"users"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) throw new Error("User not found");
    return { user };
  }),
);

export type AuthQueryCtx = ExtractCtx<typeof authQuery>;
export type AuthMutationCtx = ExtractCtx<typeof authMutation>;
```

Usage:

```typescript
import { z } from "zod";

import { authMutation } from "@repo/backend/lib/middleware";

export const createTask = authMutation({
  args: z.object({ title: z.string(), content: z.string() }),
  handler: async (ctx, args) => {
    // ctx.user is available and typed
    return await ctx.db.insert("tasks", {
      ...args,
      userId: ctx.user._id,
      createdAt: Date.now(),
    });
  },
});
```

## Summary

The current architecture is intentionally simple and direct:

- Tables defined with Zod schemas via `zodvex`
- Handlers using Convex's built-in validators
- Shared utilities for errors, logging, and environment variables
- Clear patterns ready to scale as needed

Start simple and add complexity only when needed. The patterns above show how to scale from basic handlers to sophisticated service layers with Result types, Zod validation, and authenticated middleware.
