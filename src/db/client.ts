import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error(
        "DATABASE_URL is not set. Configure it in your .env file before starting the application.",
    );
}

const parsedPoolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
const poolMax = Number.isFinite(parsedPoolMax) && parsedPoolMax > 0 ? parsedPoolMax : 10;

export const pool = new Pool({
    connectionString: databaseUrl,
    max: poolMax,
});

export const db = drizzle(pool);

export type Database = typeof db;
