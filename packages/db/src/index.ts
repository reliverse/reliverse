import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schemas from "./schema";
import { relations as appRelations } from "./schema/relations";

const {
  user,
  session,
  account,
  verification,
  userRelations,
  sessionRelations,
  accountRelations,
  ...restSchema
} = schemas;

// Schema includes tables and relation definitions (v1 API)
const schema = {
  user,
  session,
  account,
  verification,
  userRelations,
  sessionRelations,
  accountRelations,
  ...appRelations,
  ...restSchema,
};

const client = postgres(process.env.SERVER_DATABASE_URL as string);

export const db = drizzle({
  client,
  schema,
  casing: "snake_case",
});

// neon engine alternative
/* import { neon, neonConfig } from "@neondatabase/serverless";
import { env } from "@repo/env/api";
import { drizzle } from "drizzle-orm/neon-http";
import ws from "ws";

import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

// To work in edge environments (Cloudflare Workers, Vercel Edge, etc.), enable querying over fetch
// neonConfig.poolQueryViaFetch = true

const sql = neon(env.DATABASE_URL!);
export const db = drizzle(sql, { schema, casing: "snake_case" });
 */
