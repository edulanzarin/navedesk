/**
 * Cliente Drizzle/pg compartilhado.
 *
 * Usa **lazy init** para evitar conectar ao Postgres durante a fase de
 * build do Next.js (`next build` faz "Collecting page data" e importa
 * todos os módulos de Server Components, mas não tem `DATABASE_URL`
 * setado dentro do build do Docker). Apenas quando alguém de fato
 * acessa `db` ou `pool` é que o `Pool` é instanciado e a env é validada.
 *
 * Em runtime (`node server.js`) e em scripts de migrate/seed o
 * comportamento é idêntico ao de antes: a primeira leitura dispara
 * a verificação e a criação do pool. Em testes integration que setam
 * `DATABASE_URL` dinamicamente antes de importar este módulo, isso
 * também segue funcionando.
 */

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

let _pool: Pool | undefined;
let _db: NodePgDatabase | undefined;

function buildPool(): Pool {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error(
            "DATABASE_URL is not set. Configure it in your .env file before starting the application.",
        );
    }

    const parsedPoolMax = Number.parseInt(
        process.env.DATABASE_POOL_MAX ?? "",
        10,
    );
    const poolMax =
        Number.isFinite(parsedPoolMax) && parsedPoolMax > 0
            ? parsedPoolMax
            : 10;

    return new Pool({
        connectionString: databaseUrl,
        max: poolMax,
    });
}

function getPool(): Pool {
    if (!_pool) {
        _pool = buildPool();
    }
    return _pool;
}

function getDb(): NodePgDatabase {
    if (!_db) {
        _db = drizzle(getPool());
    }
    return _db;
}

/**
 * Proxies que delegam para o pool/db real apenas no primeiro uso.
 * Mantemos as exportações com os nomes originais (`pool`, `db`) para
 * preservar todos os call sites existentes.
 */
export const pool = new Proxy({} as Pool, {
    get(_target, prop, receiver) {
        const target = getPool() as unknown as Record<PropertyKey, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
    },
});

export const db = new Proxy({} as NodePgDatabase, {
    get(_target, prop, receiver) {
        const target = getDb() as unknown as Record<PropertyKey, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
    },
});

export type Database = typeof db;
