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

import { asc, and, eq, inArray } from "drizzle-orm";

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
