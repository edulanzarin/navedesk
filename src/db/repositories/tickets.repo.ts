/**
 * Tickets repository — acesso a `tickets` no Postgres via Drizzle.
 *
 * Cada função recebe o executor (`db` ou `tx`) como primeiro parâmetro,
 * permitindo que serviços orquestrem múltiplas operações dentro da mesma
 * transação (ex.: `INSERT ticket` + `INSERT ticket_event`). As consultas
 * são parametrizadas via builder tipado do Drizzle e o repositório trata
 * apenas de I/O — políticas de RBAC adicionais e regras de negócio ficam
 * na camada de serviço.
 *
 * Pontos de atenção:
 * - `findVisibleForUser` aplica o filtro RBAC do solicitante diretamente
 *   no SQL (`requesterId = user.id`), garantindo que mesmo um bug na UI
 *   não exponha tickets de terceiros (R2.4, R12.7).
 * - `listWithFilters` aplica a mesma restrição implícita para
 *   solicitantes — independentemente do que vier em `filters.requesterId`,
 *   o WHERE final sempre exige `requesterId = user.id` quando o papel é
 *   `solicitante` (R11.4).
 * - Paginação cursor-based usa o par `(updated_at, id)` como chave
 *   estável; `id` empata o ordenamento por timestamp e funciona como
 *   desempate determinístico em paginação (R11.5).
 *
 * Validates: R3.5, R10, R11.1, R11.4, R12.7.
 */

import {
    and,
    asc,
    desc,
    eq,
    gt,
    ilike,
    isNull,
    lt,
    or,
    type SQL,
} from "drizzle-orm";

import type { Database } from "@/db/client";
import { tickets } from "@/db/schema";
import type {
    Priority,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

/** Linha bruta de `tickets` conforme retornada pelo Drizzle. */
export type TicketRow = typeof tickets.$inferSelect;

/** Payload aceito por `insertTicket`, refletindo as colunas inseríveis. */
export type TicketInsert = typeof tickets.$inferInsert;

/** Patch parcial aceito por `updateTicket`. */
export type TicketUpdate = Partial<TicketInsert>;

/** Limite máximo de linhas em `listWithFilters` para conter consultas mal-formadas. */
const MAX_LIST_LIMIT = 200;

/** Limite default em `listWithFilters`, conforme o design (R11.5). */
const DEFAULT_LIST_LIMIT = 50;

/**
 * Cursor opaco para paginação de `listWithFilters`.
 *
 * Encapsula `(updated_at, id)` da última linha da página anterior.
 * Conhecido pelo cliente apenas como um objeto serializável.
 */
export interface TicketListCursor {
    updatedAt: string;
    id: string;
}

/** Filtros aceitos por `listWithFilters`. */
export interface ListFilters {
    status?: TicketStatus;
    priority?: Priority;
    categoryId?: string;
    departmentId?: string;
    /**
     * - `string`: filtra pelo `assigneeId` informado.
     * - `"me"`: resolve para `user.id` do chamador.
     * - `null`: tickets sem responsável (`assignee_id IS NULL`).
     * - `undefined`: sem filtro.
     */
    assigneeId?: string | "me" | null;
    requesterId?: string;
    /** Busca textual `ILIKE %q%` em `title` ou `id`. */
    q?: string;
    sortBy?: "createdAt" | "updatedAt" | "priority" | "slaDeadline";
    sortDir?: "asc" | "desc";
    cursor?: TicketListCursor;
    limit?: number;
}

/** Resultado paginado de `listWithFilters`. */
export interface TicketListPage {
    rows: Ticket[];
    /** Cursor para a próxima página, ou `null` quando não há mais resultados. */
    nextCursor: TicketListCursor | null;
}

/**
 * Converte a linha bruta retornada pelo Drizzle no tipo de domínio `Ticket`.
 *
 * O schema do banco armazena `rating` como `integer`, mas o domínio modela
 * o intervalo `1..5 | null` — a coerção é segura porque o valor entra via
 * Zod (`UpdateTicketSchema.rating`) e nunca é gravado fora desse intervalo.
 */
function mapToTicket(row: TicketRow): Ticket {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        categoryId: row.categoryId,
        departmentId: row.departmentId,
        requesterId: row.requesterId,
        assigneeId: row.assigneeId,
        rating: row.rating as Ticket["rating"],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        slaDeadline: row.slaDeadline,
        resolvedAt: row.resolvedAt,
        closedAt: row.closedAt,
    };
}

/**
 * Persiste um ticket recém-criado e retorna a linha gravada.
 *
 * O serviço orquestra a transação, gerando o `id` (`NVD-XXXX`), calculando
 * `slaDeadline` e linkando anexos no mesmo `tx`. Conflitos de PK
 * (improvável dado o uso de sequência) são propagados como exceção do
 * driver para o serviço traduzir em `ActionResult.error`.
 */
export async function insertTicket(
    executor: Database,
    values: TicketInsert,
): Promise<Ticket> {
    const [row] = await executor.insert(tickets).values(values).returning();
    if (!row) {
        throw new Error("insertTicket: nenhuma linha retornada após INSERT.");
    }
    return mapToTicket(row);
}

/**
 * Atualiza campos arbitrários do ticket e retorna a linha resultante.
 *
 * - `updatedAt` é definido como `new Date()` quando não está presente no
 *   patch, garantindo que toda mutação reflita o instante da operação.
 * - Retorna `null` quando nenhum ticket com o `id` informado existe; o
 *   serviço diferencia "não encontrado" (404) de "operação rejeitada"
 *   (RBAC) com base nesse retorno.
 */
export async function updateTicket(
    executor: Database,
    id: string,
    patch: TicketUpdate,
): Promise<Ticket | null> {
    const rows = await executor
        .update(tickets)
        .set({
            ...patch,
            updatedAt: patch.updatedAt ?? new Date(),
        })
        .where(eq(tickets.id, id))
        .returning();
    const row = rows[0];
    return row ? mapToTicket(row) : null;
}

/**
 * Busca um ticket pelo identificador legível (`NVD-XXXX`).
 *
 * Retorna `null` quando não existe. Não aplica filtro de RBAC — quem
 * precisa de visibilidade restrita usa `findVisibleForUser`.
 */
export async function findTicketById(
    executor: Database,
    id: string,
): Promise<Ticket | null> {
    const rows = await executor
        .select()
        .from(tickets)
        .where(eq(tickets.id, id))
        .limit(1);
    const row = rows[0];
    return row ? mapToTicket(row) : null;
}

/**
 * Busca um ticket aplicando o filtro de visibilidade do papel diretamente
 * no SQL (defesa em profundidade sobre `policies.canViewTicket`).
 *
 * - `admin` e `tecnico`: leitura irrestrita.
 * - `solicitante`: a query inclui `requesterId = user.id`; tickets de
 *   outros solicitantes simplesmente não retornam (404 indistinguível de
 *   "não existe", evitando enumeração).
 */
export async function findVisibleForUser(
    executor: Database,
    user: SessionUser,
    id: string,
): Promise<Ticket | null> {
    const condition =
        user.role === "solicitante"
            ? and(eq(tickets.id, id), eq(tickets.requesterId, user.id))
            : eq(tickets.id, id);

    const rows = await executor
        .select()
        .from(tickets)
        .where(condition)
        .limit(1);
    const row = rows[0];
    return row ? mapToTicket(row) : null;
}

/**
 * Resolve `assigneeId` do filtro para uma condição SQL.
 *
 * `"me"` é resolvido para `user.id`; `null` vira `IS NULL`; string passa
 * por `eq`; `undefined` retorna `undefined` (sem filtro).
 */
function buildAssigneeCondition(
    user: SessionUser,
    assigneeId: ListFilters["assigneeId"],
): SQL | undefined {
    if (assigneeId === undefined) return undefined;
    if (assigneeId === null) return isNull(tickets.assigneeId);
    if (assigneeId === "me") return eq(tickets.assigneeId, user.id);
    return eq(tickets.assigneeId, assigneeId);
}

/**
 * Constrói a condição de avanço de página a partir do cursor.
 *
 * Para ordenação descendente: `(updated_at, id) < (cursor.updatedAt, cursor.id)`.
 * Para ascendente: `(updated_at, id) > (cursor.updatedAt, cursor.id)`.
 *
 * Implementado como `OR/AND` em vez de tupla SQL crua para manter o
 * builder tipado e portátil. Usar `id` como desempate garante avanço
 * estável mesmo quando múltiplas linhas compartilham o mesmo
 * `updated_at`.
 */
function buildCursorCondition(
    cursor: TicketListCursor,
    direction: "asc" | "desc",
): SQL {
    const cursorDate = new Date(cursor.updatedAt);
    if (direction === "desc") {
        return or(
            lt(tickets.updatedAt, cursorDate),
            and(
                eq(tickets.updatedAt, cursorDate),
                lt(tickets.id, cursor.id),
            ),
        ) as SQL;
    }
    return or(
        gt(tickets.updatedAt, cursorDate),
        and(eq(tickets.updatedAt, cursorDate), gt(tickets.id, cursor.id)),
    ) as SQL;
}

/**
 * Lista tickets aplicando filtros, RBAC e paginação cursor-based.
 *
 * Comportamento:
 * - Para `solicitante`, o WHERE sempre inclui `requesterId = user.id`,
 *   sobrescrevendo qualquer `filters.requesterId` recebido (R11.4).
 * - `assigneeId === "me"` é resolvido para o id do chamador.
 * - `q` busca em `title` ou `id` via `ILIKE` case-insensitive.
 * - Ordenação default: `updatedAt DESC`. `id` entra como desempate na
 *   mesma direção para paginação estável.
 * - O cursor encode o par `(updatedAt, id)` da última linha. A semântica
 *   é coerente com a ordenação default; alterar `sortBy` invalida cursores
 *   gerados anteriormente — o cliente deve resetar a paginação ao mudar
 *   o sort.
 * - Para detectar a existência da próxima página, busca-se `limit + 1` e
 *   trunca-se o resultado: se sobrou, há próxima página e o cursor é
 *   gerado a partir da última linha **mantida**.
 */
export async function listWithFilters(
    executor: Database,
    user: SessionUser,
    filters: ListFilters,
): Promise<TicketListPage> {
    const sortBy = filters.sortBy ?? "updatedAt";
    const sortDir = filters.sortDir ?? "desc";
    const requestedLimit = filters.limit ?? DEFAULT_LIST_LIMIT;
    const limit = Math.min(
        Math.max(1, Math.floor(requestedLimit)),
        MAX_LIST_LIMIT,
    );

    const conditions: SQL[] = [];

    // RBAC para solicitantes: filtro implícito pelo próprio id.
    if (user.role === "solicitante") {
        conditions.push(eq(tickets.requesterId, user.id));
    } else if (filters.requesterId !== undefined) {
        conditions.push(eq(tickets.requesterId, filters.requesterId));
    }

    if (filters.status !== undefined) {
        conditions.push(eq(tickets.status, filters.status));
    }
    if (filters.priority !== undefined) {
        conditions.push(eq(tickets.priority, filters.priority));
    }
    if (filters.categoryId !== undefined) {
        conditions.push(eq(tickets.categoryId, filters.categoryId));
    }
    if (filters.departmentId !== undefined) {
        conditions.push(eq(tickets.departmentId, filters.departmentId));
    }

    const assigneeCondition = buildAssigneeCondition(user, filters.assigneeId);
    if (assigneeCondition) {
        conditions.push(assigneeCondition);
    }

    if (filters.q !== undefined && filters.q.trim().length > 0) {
        const pattern = `%${filters.q.trim()}%`;
        conditions.push(
            or(ilike(tickets.title, pattern), ilike(tickets.id, pattern)) as SQL,
        );
    }

    if (filters.cursor) {
        conditions.push(buildCursorCondition(filters.cursor, sortDir));
    }

    const whereClause =
        conditions.length === 0
            ? undefined
            : conditions.length === 1
                ? conditions[0]
                : and(...conditions);

    const direction = sortDir === "asc" ? asc : desc;
    const sortColumn =
        sortBy === "createdAt"
            ? tickets.createdAt
            : sortBy === "priority"
                ? tickets.priority
                : sortBy === "slaDeadline"
                    ? tickets.slaDeadline
                    : tickets.updatedAt;

    // Buscar `limit + 1` para detectar a existência da próxima página.
    const baseQuery = executor.select().from(tickets);
    const filtered = whereClause ? baseQuery.where(whereClause) : baseQuery;
    const rows = await filtered
        .orderBy(direction(sortColumn), direction(tickets.id))
        .limit(limit + 1);

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;

    let nextCursor: TicketListCursor | null = null;
    if (hasNext) {
        const last = pageRows[pageRows.length - 1];
        if (last) {
            nextCursor = {
                updatedAt: last.updatedAt.toISOString(),
                id: last.id,
            };
        }
    }

    return {
        rows: pageRows.map(mapToTicket),
        nextCursor,
    };
}
