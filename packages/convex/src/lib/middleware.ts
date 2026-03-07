/**
 * Convex middleware with Zod validation using zodvex.
 *
 * Why Zod validators?
 * - Share validation schemas with frontend for type-safe forms
 * - Rich validation (min/max length, regex, email, etc.) beyond Convex's `v.*`
 * - Infer TypeScript types directly from schemas with `z.infer<>`
 * - Single source of truth for input validation across client and server
 *
 * Basic Usage:
 * @example
 * import { z } from "zod"
 * import { mutation } from "@repo/backend/lib/middleware"
 *
 * const createTaskInput = z.object({
 *   text: z.string().min(1).max(500),
 *   priority: z.enum(["low", "medium", "high"]).optional(),
 * })
 *
 * export const create = mutation({
 *   args: createTaskInput,
 *   handler: async (ctx, args) => {
 *     // args is fully typed from Zod schema
 *     return await ctx.db.insert("tasks", { ...args })
 *   },
 * })
 *
 * Authenticated Middleware:
 * For protected routes, use `zCustomQueryBuilder`, `zCustomMutationBuilder`,
 * and `zCustomActionBuilder` with `customCtx` to extend the context with user data.
 *
 * @example
 * import type { ExtractCtx } from "zodvex"
 * import { customCtx, zCustomQueryBuilder } from "zodvex"
 * import type { Doc } from "@repo/backend/_generated/dataModel"
 * import type { QueryCtx } from "@repo/backend/_generated/server"
 * import { query as convexQuery } from "@repo/backend/_generated/server"
 *
 * export const authQuery = zCustomQueryBuilder(
 *   convexQuery,
 *   customCtx(async (ctx: QueryCtx): Promise<{ user: Doc<"users"> }> => {
 *     const identity = await ctx.auth.getUserIdentity()
 *     if (!identity) throw new Error("Unauthorized")
 *
 *     const user = await ctx.db
 *       .query("users")
 *       .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
 *       .unique()
 *
 *     if (!user) throw new Error("User not found")
 *     return { user }
 *   }),
 * )
 *
 * // Extract the context type for use in services
 * export type AuthQueryCtx = ExtractCtx<typeof authQuery>
 *
 * // Usage in handlers
 * export const getCurrentUser = authQuery({
 *   args: z.object({}),
 *   handler: async (ctx, args) => {
 *     // ctx.user is available and typed as Doc<"users">
 *     return ctx.user
 *   },
 * })
 */
import { zActionBuilder, zMutationBuilder, zQueryBuilder } from "zodvex";

import {
  action as convexAction,
  mutation as convexMutation,
  query as convexQuery,
} from "../_generated/server";

/**
 * Public query builder with Zod validation.
 * Use for unauthenticated or public queries.
 */
export const query = zQueryBuilder(convexQuery);

/**
 * Public mutation builder with Zod validation.
 * Use for unauthenticated or public mutations.
 */
export const mutation = zMutationBuilder(convexMutation);

/**
 * Public action builder with Zod validation.
 * Use for unauthenticated or public actions.
 */
export const action = zActionBuilder(convexAction);
