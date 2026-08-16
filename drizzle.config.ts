import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.CARERA_DB_PATH ?? "./data/carera-cashflow.db",
  },
} satisfies Config;
