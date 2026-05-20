/**
 * Real-time event bus baseado em Postgres LISTEN/NOTIFY.
 *
 * Como funciona:
 *
 * 1. **Publicação**: serviços de domínio (tickets, messages, notifications)
 *    chamam `publishEvent(executor, event)` dentro da própria transação que
 *    altera os dados. O `pg_notify` só dispara quando a transação faz
 *    COMMIT — então jamais notificamos algo que rolou rollback.
 *
 * 2. **Escuta**: cada conexão SSE (`/api/events`) registra um listener
 *    no `RealtimeBus` (singleton de processo). O Bus mantém uma única
 *    conexão `pg.Client` permanente fazendo `LISTEN navedesk_events`.
 *    Quando uma mensagem chega, ela é distribuída para todos os
 *    listeners interessados — cada SSE filtra por `userId` quando
 *    aplicável.
 *
 * 3. **Resiliência**: se a conexão pg cair, o Bus tenta reconectar
 *    automaticamente após 5s. Os listeners SSE permanecem registrados
 *    e voltam a receber eventos assim que a conexão é restabelecida.
 *
 * Por que um único `pg.Client` em vez de uma conexão por SSE?
 * - 200 usuários simultâneos seriam 200 conexões dedicadas ao banco —
 *   gasto demais. Compartilhar uma única conexão de LISTEN é prática
 *   estabelecida (Supabase Realtime, hasura, etc.).
 * - O `EventEmitter` interno faz o fan-out em memória, que é barato.
 *
 * O singleton é guardado em `globalThis` para sobreviver ao Hot Module
 * Reload do Next.js em dev — sem isso, `next dev` empilharia listeners
 * a cada save.
 */

import { EventEmitter } from "node:events";

import { sql } from "drizzle-orm";
import { Client as PgClient } from "pg";

import type { Database } from "@/db/client";
import { logger, swallow } from "@/lib/logger";

/** Canal único de notificações do Postgres. */
const CHANNEL = "navedesk_events";

/** Delay (ms) antes de tentar reconectar após queda da conexão LISTEN. */
const RECONNECT_DELAY_MS = 5_000;

/**
 * Tipos de evento que circulam pelo bus. O `userId`, quando presente,
 * limita a entrega àquele destinatário; quando ausente, o evento é
 * broadcast (todos os clients recebem).
 *
 * - `notification`  — nova notificação criada para `userId`. Os clients
 *   usam isso para atualizar o badge de não-lidas e disparar a
 *   notificação desktop.
 * - `ticket_changed`  — algo mudou em `ticketId` (status, prioridade,
 *   atribuição, mensagem). Broadcast para todos — cada client decide
 *   se a página atual depende daquele ticket e refresha.
 * - `tickets_list_changed` — qualquer mutação que afete listagens
 *   (criação, status, atribuição). Broadcast.
 */
export interface RealtimeEvent {
    type:
        | "notification"
        | "notification_read"
        | "ticket_changed"
        | "tickets_list_changed"
        | "users_changed";
    userId?: string;
    ticketId?: string;
}

class RealtimeBus extends EventEmitter {
    private client: PgClient | null = null;
    private connecting: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        super();
        // Default do EventEmitter é 10; com muitos SSE simultâneos
        // (1 por aba aberta de cada usuário) precisamos liberar.
        this.setMaxListeners(0);
    }

    /**
     * Garante que a conexão LISTEN está ativa. Idempotente: chamadas
     * concorrentes durante a primeira conexão compartilham a mesma
     * `Promise`. Chamado pelo handler SSE no início de cada conexão.
     */
    async ensureListener(): Promise<void> {
        if (this.client) return;
        if (this.connecting) return this.connecting;

        this.connecting = (async () => {
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) {
                throw new Error("DATABASE_URL is not set.");
            }

            const client = new PgClient({ connectionString: databaseUrl });

            client.on("notification", (msg) => {
                if (msg.channel !== CHANNEL || !msg.payload) return;
                try {
                    const event = JSON.parse(msg.payload) as RealtimeEvent;
                    this.emit("event", event);
                } catch {
                    // payload malformado — ignora silenciosamente
                }
            });

            client.on("error", (err) => {
                logger.error({ err, scope: "realtime" }, "pg client error");
                this.scheduleReconnect();
            });

            client.on("end", () => {
                logger.warn({ scope: "realtime" }, "pg client connection ended");
                this.scheduleReconnect();
            });

            await client.connect();
            await client.query(`LISTEN ${CHANNEL}`);
            this.client = client;
        })();

        try {
            await this.connecting;
        } finally {
            this.connecting = null;
        }
    }

    /**
     * Agenda uma reconexão após falha. Limpa a flag de cliente para
     * que a próxima `ensureListener` reabra do zero.
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.client = null;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureListener().catch((err) => {
                logger.error(
                    { err, scope: "realtime" },
                    "reconnect failed",
                );
            });
        }, RECONNECT_DELAY_MS);
    }
}

/**
 * Singleton com persistência via `globalThis` (sobrevive ao HMR do
 * Next em dev).
 */
const GLOBAL_KEY = Symbol.for("navedesk:realtime-bus");
type GlobalWithBus = typeof globalThis & {
    [GLOBAL_KEY]?: RealtimeBus;
};

export function getRealtimeBus(): RealtimeBus {
    const g = globalThis as GlobalWithBus;
    if (!g[GLOBAL_KEY]) {
        g[GLOBAL_KEY] = new RealtimeBus();
    }
    return g[GLOBAL_KEY]!;
}

/**
 * Publica um evento. Usa o `executor` recebido (transação ou conexão
 * base) para que o `pg_notify` participe da mesma transação que
 * gerou o evento — só dispara após COMMIT, evitando notificações
 * fantasma.
 *
 * Falhas são logadas mas **não** propagadas: a mutação principal já
 * foi commitada quando isso falha (ou está prestes a). Não faz sentido
 * abortar uma operação bem-sucedida porque o broadcast falhou.
 */
export async function publishEvent(
    executor: Database,
    event: RealtimeEvent,
): Promise<void> {
    const payload = JSON.stringify(event);
    try {
        await executor.execute(sql`SELECT pg_notify(${CHANNEL}, ${payload})`);
    } catch (err) {
        swallow("publishEvent failed", err, { scope: "realtime", event });
    }
}
