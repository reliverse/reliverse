import type { DatabaseProvider } from "~/types.js";

export const COLUMN_TYPES: Record<DatabaseProvider, string[]> = {
  postgres: [
    "serial",
    "integer",
    "bigint",
    "text",
    "varchar",
    "boolean",
    "timestamp",
    "timestamptz",
    "date",
    "time",
    "uuid",
    "json",
    "jsonb",
    "decimal",
    "real",
    "double",
  ],
  mysql: [
    "int",
    "bigint",
    "varchar",
    "text",
    "boolean",
    "timestamp",
    "datetime",
    "date",
    "time",
    "json",
    "decimal",
    "float",
    "double",
  ],
  sqlite: ["integer", "text", "blob", "real", "numeric", "boolean", "datetime"],
};
