import type { Config } from "drizzle-kit";

// @ts-expect-error ...
import { env } from "./src/env";

export default {
	schema: "./src/core/server/db/schema.ts",
	driver: "pg",
	dbCredentials: {
		connectionString: env.DATABASE_URL,
	},
	tablesFilter: ["project1_*"],
} satisfies Config;
