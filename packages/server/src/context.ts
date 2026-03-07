import { auth } from "@repo/auth";
import type { Context as ElysiaContext } from "elysia";

export interface CreateContextOptions {
  context: ElysiaContext;
}

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });
  return {
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
