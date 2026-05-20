/**
 * Users repository — acesso a `users` no Postgres via Drizzle.
 *
 * Cada função recebe o executor (`db` ou `tx`) como primeiro parâmetro,
 * permitindo que serviços orquestrem múltiplas operações dentro da mesma
 * transação. As consultas são parametrizadas e retornam linhas tal como
 * vêm do banco — políticas de visibilidade e regras de negócio são aplicadas
 * na camada de serviço.
 *
 * Validates: R14.
 */

import { asc, and, eq, gt, ilike, inArray, or, type SQL } from "drizzle-orm";

import type { Database } from "@/db/client";
import { users } from "@/db/schema";
import type { Role } from "@/types/domain";

/** Linha bruta de `users` conforme retornada pelo Drizzle. */
export type UserRow = typeof users.$inferSelect;

/** Payload aceito por `insertUser`, refletindo as colunas inseríveis. */
export type UserInsert = typeof users.$inferInsert;

/**
 * Busca um usuário pelo email (campo único).
 *
 * Retorna `null` quando não existe — útil para o fluxo de login, que precisa
 * tratar usuário inexistente e senha incorreta com a mesma resposta genérica.
 */
export async function findByEmail(
    db: Database,
    email: string,
): Promise<UserRow | null> {
    const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Busca um usuário pelo identificador (UUID).
 */
export async function findById(
    db: Database,
    id: string,
): Promise<UserRow | null> {
    const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Lista todos os usuários cadastrados, ordenados por nome (A→Z).
 *
 * Usado pela tela de administração; o filtro por `active` é responsabilidade
 * do serviço/UI quando aplicável.
 */
export async function listAll(db: Database): Promise<UserRow[]> {
    return db.select().from(users).orderBy(asc(users.name));
}

/**
 * Filtros aceitos por `listUsersPage`. Todos opcionais.
 */
export interface UserListFilters {
    /** Busca textual (`ILIKE %q%`) em `name` ou `email`. */
    q?: string;
    /** Filtra pelo papel quando informado. */
    role?: Role;
}

/** Cursor opaco — `(name, id)` da última linha da página anterior. */
export interface UserListCursor {
    name: string;
    id: string;
}

export interface UserListPage {
    rows: UserRow[];
    nextCursor: UserListCursor | null;
}

/**
 * Lista usuários paginados via cursor sobre `(name ASC, id ASC)`.
 *
 * Suporta busca textual em nome/email e filtro por papel. Retorna até
 * `limit` linhas + um cursor opaco para a próxima página quando
 * houver mais resultados. Limite default 50, máximo 200.
 *
 * Por que `(name, id)` e não offset? Porque admins frequentemente
 * acessam essa página enquanto cadastros novos chegam (broadcast SSE
 * dispara refresh). Cursor estável evita pular ou repetir linhas
 * quando uma inserção acontece entre páginas.
 */
export async function listUsersPage(
    db: Database,
    filters: UserListFilters = {},
    cursor?: UserListCursor,
    limit: number = 50,
): Promise<UserListPage> {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);

    const conditions: SQL[] = [];

    if (filters.q !== undefined && filters.q.trim().length > 0) {
        const pattern = `%${filters.q.trim()}%`;
        conditions.push(
            or(ilike(users.name, pattern), ilike(users.email, pattern)) as SQL,
        );
    }
    if (filters.role !== undefined) {
        conditions.push(eq(users.role, filters.role));
    }
    if (cursor) {
        // (name, id) > (cursor.name, cursor.id) na ordem ascendente.
        conditions.push(
            or(
                gt(users.name, cursor.name),
                and(
                    eq(users.name, cursor.name),
                    gt(users.id, cursor.id),
                ),
            ) as SQL,
        );
    }

    const where =
        conditions.length === 0
            ? undefined
            : conditions.length === 1
                ? conditions[0]
                : and(...conditions);

    const baseQuery = db.select().from(users);
    const filtered = where ? baseQuery.where(where) : baseQuery;
    const rows = await filtered
        .orderBy(asc(users.name), asc(users.id))
        .limit(safeLimit + 1);

    const hasNext = rows.length > safeLimit;
    const pageRows = hasNext ? rows.slice(0, safeLimit) : rows;

    let nextCursor: UserListCursor | null = null;
    if (hasNext) {
        const last = pageRows[pageRows.length - 1];
        if (last) nextCursor = { name: last.name, id: last.id };
    }

    return { rows: pageRows, nextCursor };
}

/**
 * Lista usuários que podem ser responsáveis por tickets — técnicos e
 * administradores ativos, ordenados por nome (A→Z).
 *
 * Usado pelo painel de controles do detalhe do ticket (`/tickets/{id}`)
 * para popular o `Select` de "Atribuir a outro" disponível apenas para
 * admins (R5.3). O filtro `active = true` evita oferecer destinatários
 * que estejam fora do sistema, em coerência com o que o serviço de
 * atribuição valida (`INVALID_ASSIGNEE` para usuários inativos).
 */
export async function listAssignable(db: Database): Promise<UserRow[]> {
    const assignableRoles: Role[] = ["tecnico", "admin"];
    return db
        .select()
        .from(users)
        .where(
            and(
                inArray(users.role, assignableRoles),
                eq(users.active, true),
            ),
        )
        .orderBy(asc(users.name));
}

/**
 * Busca múltiplos usuários por seus identificadores em uma única query.
 *
 * Retorna apenas os usuários encontrados — se algum `id` não existir no
 * banco, ele simplesmente não aparece no resultado (a checagem por
 * presença/ausência é responsabilidade do caller). Aceita um array
 * vazio de entrada e devolve um array vazio sem disparar a consulta —
 * evitando o caso degenerado `WHERE id IN ()` que o driver rejeita.
 *
 * Usado por páginas que precisam resolver o autor de várias linhas
 * (mensagens, eventos, atribuições) com um único round-trip ao banco,
 * substituindo o padrão N+1 de `findById` em loop.
 */
export async function findByIds(
    db: Database,
    ids: readonly string[],
): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return db.select().from(users).where(inArray(users.id, ids as string[]));
}

/**
 * Lista usuários ativos por papel, ordenados por nome (A→Z).
 *
 * Usado no fan-out de notificações (ex.: avisar todos os técnicos
 * quando um ticket é criado). O filtro `active = true` garante que
 * usuários desligados não recebam mais notificações pendentes que
 * acumulariam para sempre.
 */
export async function listByRole(
    db: Database,
    role: Role,
): Promise<UserRow[]> {
    return db
        .select()
        .from(users)
        .where(and(eq(users.role, role), eq(users.active, true)))
        .orderBy(asc(users.name));
}

/**
 * Lista usuários ativos com qualquer um dos papéis informados,
 * ordenados por nome (A→Z). Versão multi-papel de `listByRole` para
 * fan-out que combine `tecnico` e `admin` (caso típico de criação
 * de ticket).
 */
export async function listByRoles(
    db: Database,
    roles: readonly Role[],
): Promise<UserRow[]> {
    if (roles.length === 0) return [];
    return db
        .select()
        .from(users)
        .where(
            and(
                inArray(users.role, roles as Role[]),
                eq(users.active, true),
            ),
        )
        .orderBy(asc(users.name));
}

/**
 * Insere um usuário e retorna a linha persistida.
 *
 * Conflitos de email (constraint `users.email` UNIQUE) são propagados como
 * exceção do driver para que o serviço os traduza em `ActionResult.error`.
 */
export async function insertUser(
    db: Database,
    values: UserInsert,
): Promise<UserRow> {
    const [row] = await db.insert(users).values(values).returning();
    if (!row) {
        throw new Error("insertUser: nenhuma linha retornada após INSERT.");
    }
    return row;
}

/**
 * Ativa ou desativa um usuário. Retorna a linha atualizada ou `null` quando
 * o `id` não existe.
 */
export async function updateUserActive(
    db: Database,
    id: string,
    active: boolean,
): Promise<UserRow | null> {
    const rows = await db
        .update(users)
        .set({ active })
        .where(eq(users.id, id))
        .returning();
    return rows[0] ?? null;
}

/**
 * Atualiza o `passwordHash` do usuário. Retorna a linha atualizada ou
 * `null` quando o `id` não existe. Usado no fluxo de troca de senha
 * pelo próprio usuário em `/perfil` (R1.6).
 */
export async function updateUserPassword(
    db: Database,
    id: string,
    passwordHash: string,
): Promise<UserRow | null> {
    const rows = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, id))
        .returning();
    return rows[0] ?? null;
}

/**
 * Atualiza o papel (RBAC) do usuário. Retorna a linha atualizada ou `null`
 * quando o `id` não existe.
 */
export async function updateUserRole(
    db: Database,
    id: string,
    role: Role,
): Promise<UserRow | null> {
    const rows = await db
        .update(users)
        .set({ role })
        .where(eq(users.id, id))
        .returning();
    return rows[0] ?? null;
}
/**
 * Atualiza a aparência do avatar do usuário (cor e/ou foto).
 *
 * Retorna a linha atualizada ou `null` quando o `id` não existe.
 * Aceita um patch parcial: campos `undefined` ficam fora do `set`,
 * preservando o valor atual no banco. Para limpar a foto de perfil,
 * passe `avatarUrl: null`.
 */
export async function updateUserAvatar(
    db: Database,
    id: string,
    patch: { avatarColor?: string; avatarUrl?: string | null },
): Promise<UserRow | null> {
    const set: Partial<{ avatarColor: string; avatarUrl: string | null }> = {};
    if (patch.avatarColor !== undefined) set.avatarColor = patch.avatarColor;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
    if (Object.keys(set).length === 0) return null;

    const rows = await db
        .update(users)
        .set(set)
        .where(eq(users.id, id))
        .returning();
    return rows[0] ?? null;
}
