/**
 * Convex schema definition using zodvex for Zod-based table validation.
 *
 * Tables are defined in `/tables` using `zodTable()` which converts Zod schemas
 * to Convex table definitions. Import tables here and add indexes as needed.
 *
 * Note: Zod's `.default()` does not work with zodvex - defaults must be handled
 * in your mutation/service logic when inserting documents.
 *
 * @example
 * // Define a table in /tables/users.ts
 * import { z } from "zod"
 * import { zodTable } from "zodvex"
 *
 * export const Users = zodTable("users", {
 *   email: z.string().email(),
 *   name: z.string(),
 *   role: z.enum(["admin", "member", "guest"]),
 *   createdAt: z.number(),
 * })
 *
 * @example
 * // Import and add indexes in schema.ts
 * import { Users } from "./tables/users"
 *
 * export default defineSchema({
 *   users: Users.table
 *     .index("by_email", ["email"])
 *     .index("by_role", ["role"]),
 * })
 */
import { defineSchema } from "convex/server";

import { Tasks } from "./tables/tasks";

export default defineSchema({
  tasks: Tasks.table,
});
