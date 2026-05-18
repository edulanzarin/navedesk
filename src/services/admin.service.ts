/**
 * Admin service — operações administrativas sobre `sla_policies` e
 * `categories` (R6.10, R15).
 *
 * Concentra as três famílias de mutação que só `admin` pode executar:
 *
 * - **Política de SLA** (`updateSlaPolicy`): ajusta as horas associadas a
 *   uma prioridade. O valor passa a valer apenas para tickets criados
 *   após a alteração — tickets já existentes preservam seu `slaDeadline`,
 *   por isso este caminho **não** toca em `tickets` (R6.10). Após o
 *   UPDATE, o cache de políticas (TTL 60s) é invalidado para que a
 *   próxima leitura veja o novo estado (R15.3).
 *
 * - **Categorias** (`createCategory`, `deactivateCategory`,
 *   `deleteCategory`): mantêm o catálogo usado pelos formulários de
 *   abertura de ticket. Conflitos de PK em criação são traduzidos para
 *   `CONFLICT`. Exclusão é rejeitada com `IN_USE` quando há tickets
 *   referenciando a categoria, sugerindo desativação (R15.7) — assim
 *   tickets históricos preservam sua taxonomia.
 *
 * Todas as funções retornam `ActionResult<T>` para que Server Actions
 * mapeiem falhas tratáveis sem capturar exceções. Erros inesperados do
 * driver propagam para serem mapeados em telemetria/HTTP 500 pelo caller.
 *
 * Validates: R6.10, R15.
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { categories, departments, slaPolicies, tickets, users } from "@/db/schema";
import {
    canManageCategories,
    canManageDepartments,
    canManageSla,
} from "@/lib/policies";
import {
    CreateCategorySchema,
    CreateDepartmentSchema,
    UpdateDepartmentSchema,
    UpdateSlaPolicySchema,
} from "@/lib/schemas";
import {
    invalidateCategoriesCache,
    invalidateDepartmentsCache,
    invalidateSlaPoliciesCache,
} from "@/services/reads.service";
import type {
    ActionResult,
    Priority,
    SessionUser,
} from "@/types/domain";

/**
 * `ActionResult.error` reutilizável para o erro de autorização do admin.
 * Centraliza a mensagem para manter consistência entre as quatro funções
 * abaixo.
 */
function forbiddenError(): ActionResult<never> {
    return {
        ok: false,
        error: {
            code: "FORBIDDEN",
            message: "Apenas administradores podem executar esta operação.",
        },
    };
}

/**
 * Constrói o `ActionResult.error` padrão para falhas de validação Zod,
 * mantendo o mesmo formato adotado nos demais serviços (mensagem do
 * primeiro `issue`, com `field` apontando o caminho quando existir).
 */
function validationErrorFromZod(
    issue: import("zod").ZodIssue | undefined,
): ActionResult<never> {
    const field =
        issue && issue.path.length > 0 ? issue.path.join(".") : undefined;
    return {
        ok: false,
        error: {
            code: "VALIDATION",
            message: issue?.message ?? "Entrada inválida.",
            ...(field ? { field } : {}),
        },
    };
}

/**
 * Detecta violação de UNIQUE/PK do PostgreSQL (`SQLSTATE 23505`).
 *
 * `node-postgres` propaga o erro com a propriedade `code` igual ao
 * SQLSTATE. Espelha a heurística usada em `kb.service.ts` para evitar
 * acoplar este módulo ao tipo `pg.DatabaseError`.
 */
function isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && code === "23505";
}

/**
 * Atualiza a política de SLA de uma prioridade (R15.2, R15.3, R6.10).
 *
 * Pipeline:
 *
 * 1. Verifica `canManageSla(actor)`. Falha → `FORBIDDEN`.
 * 2. Valida `rawInput` com `UpdateSlaPolicySchema` (`priority` enum,
 *    `minutes` inteiro positivo). Falha → `VALIDATION`.
 * 3. Executa um único `UPDATE sla_policies SET minutes = ?, updated_at = now()
 *    WHERE priority = ?`. Se nenhuma linha for afetada, retorna `NOT_FOUND`
 *    — em operação normal o seed pré-popula as quatro prioridades, então
 *    isso só acontece se alguém apagar a linha manualmente.
 * 4. **Não atualiza** tickets já existentes: o requisito R6.10 exige que
 *    a nova política se aplique apenas a tickets criados após a mudança;
 *    tickets em andamento mantêm o `slaDeadline` calculado na criação.
 * 5. Invalida `STABLE_READ_KEYS.slaPolicies` para que `getAllSlaPolicies`
 *    devolva o novo estado na próxima leitura sem aguardar a expiração
 *    natural de 60s (R15.3).
 *
 * Retorna o par `{ priority, minutes }` efetivamente persistido para que
 * a Server Action chamadora possa exibir confirmação ao operador.
 */
export async function updateSlaPolicy(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<{ priority: Priority; minutes: number }>> {
    if (!canManageSla(actor)) return forbiddenError();

    const parsed = UpdateSlaPolicySchema.safeParse(rawInput);
    if (!parsed.success) {
        return validationErrorFromZod(parsed.error.issues[0]);
    }
    const { priority, minutes } = parsed.data;

    const updated = await db
        .update(slaPolicies)
        .set({ minutes, updatedAt: new Date() })
        .where(eq(slaPolicies.priority, priority))
        .returning({ priority: slaPolicies.priority, minutes: slaPolicies.minutes });

    if (updated.length === 0) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Política de SLA não encontrada para a prioridade informada.",
                field: "priority",
            },
        };
    }

    // R6.10: tickets existentes preservam seu `slaDeadline`. Nenhum UPDATE
    // em `tickets` é executado aqui de propósito.
    invalidateSlaPoliciesCache();

    const row = updated[0]!;
    return { ok: true, data: { priority: row.priority, minutes: row.minutes } };
}

/**
 * Cria uma nova categoria de chamado (R15.5).
 *
 * Pipeline:
 *
 * 1. Verifica `canManageCategories(actor)`. Falha → `FORBIDDEN`.
 * 2. Valida `rawInput` com `CreateCategorySchema`. Falha → `VALIDATION`.
 * 3. INSERT com `active=true` (default explicitado pelo schema). Caso o
 *    `id` informado já exista, captura `SQLSTATE 23505` e devolve
 *    `CONFLICT` apontando o campo `id` para o formulário sinalizar.
 * 4. Invalida `STABLE_READ_KEYS.categories` para refletir a nova categoria
 *    imediatamente nos formulários de abertura de ticket.
 *
 * Retorna `{ id }` da categoria criada.
 */
export async function createCategory(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
    if (!canManageCategories(actor)) return forbiddenError();

    const parsed = CreateCategorySchema.safeParse(rawInput);
    if (!parsed.success) {
        return validationErrorFromZod(parsed.error.issues[0]);
    }
    const input = parsed.data;

    try {
        const inserted = await db
            .insert(categories)
            .values({
                id: input.id,
                label: input.label,
                sub: input.sub,
                icon: input.icon,
                active: true,
            })
            .returning({ id: categories.id });

        const row = inserted[0];
        if (!row) {
            // Defesa em profundidade: o INSERT bem-sucedido sempre
            // retorna ao menos uma linha; chegar aqui indica problema
            // de driver e merece fail-loud.
            throw new Error(
                "createCategory: INSERT retornou sem linhas, estado inesperado.",
            );
        }

        invalidateCategoriesCache();
        return { ok: true, data: { id: row.id } };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe uma categoria com esse identificador.",
                    field: "id",
                },
            };
        }
        throw err;
    }
}

/**
 * Marca uma categoria como inativa (R15.6).
 *
 * Categorias desativadas saem dos formulários de abertura de ticket, mas
 * tickets antigos que as referenciam continuam funcionando — apenas a
 * descoberta para novos chamados é afetada. Por isso usamos UPDATE em vez
 * de DELETE.
 *
 * Pipeline:
 *
 * 1. Verifica `canManageCategories(actor)`. Falha → `FORBIDDEN`.
 * 2. UPDATE `categories SET active=false WHERE id=?`. Sem linhas →
 *    `NOT_FOUND`.
 * 3. Invalida o cache de categorias.
 *
 * É idempotente: chamar duas vezes na mesma categoria mantém `active=false`
 * e devolve `ok: true` em ambas (a segunda chamada apenas reescreve o
 * mesmo valor).
 */
export async function deactivateCategory(
    actor: SessionUser,
    id: string,
): Promise<ActionResult<void>> {
    if (!canManageCategories(actor)) return forbiddenError();

    const updated = await db
        .update(categories)
        .set({ active: false })
        .where(eq(categories.id, id))
        .returning({ id: categories.id });

    if (updated.length === 0) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Categoria não encontrada.",
            },
        };
    }

    invalidateCategoriesCache();
    return { ok: true, data: undefined };
}

/**
 * Exclui uma categoria, rejeitando quando há tickets associados (R15.7).
 *
 * Pipeline (em transação para garantir consistência entre o check e o
 * DELETE):
 *
 * 1. Verifica `canManageCategories(actor)`. Falha → `FORBIDDEN`.
 * 2. Conta tickets com `category_id = id`. Se houver pelo menos um,
 *    aborta com `IN_USE` sugerindo a desativação como alternativa.
 * 3. DELETE da categoria. Sem linhas → `NOT_FOUND`.
 * 4. Invalida o cache de categorias.
 *
 * O serviço **não** apaga tickets em cascata. A FK `tickets.category_id`
 * referencia `categories.id` sem `ON DELETE` explícito, então o próprio
 * Postgres rejeitaria o DELETE — mas verificar antecipadamente devolve
 * uma mensagem mais útil ao operador (R15.7) e evita depender de
 * mensagens de erro do driver para distinguir `IN_USE` de outras falhas.
 */
export async function deleteCategory(
    actor: SessionUser,
    id: string,
): Promise<ActionResult<void>> {
    if (!canManageCategories(actor)) return forbiddenError();

    type DeleteOutcome =
        | { kind: "deleted" }
        | { kind: "not_found" }
        | { kind: "in_use" };

    const outcome: DeleteOutcome = await db.transaction(async (tx) => {
        // Conta tickets referenciando a categoria. `count(*)` retorna
        // string em pg; converter para número antes de comparar.
        const counted = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(tickets)
            .where(eq(tickets.categoryId, id));
        const ticketCount = counted[0]?.count ?? 0;

        if (ticketCount > 0) {
            return { kind: "in_use" };
        }

        const deleted = await tx
            .delete(categories)
            .where(eq(categories.id, id))
            .returning({ id: categories.id });

        if (deleted.length === 0) {
            return { kind: "not_found" };
        }
        return { kind: "deleted" };
    });

    if (outcome.kind === "in_use") {
        return {
            ok: false,
            error: {
                code: "IN_USE",
                message:
                    "Esta categoria possui tickets associados e não pode ser excluída. Considere desativá-la.",
            },
        };
    }

    if (outcome.kind === "not_found") {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Categoria não encontrada.",
            },
        };
    }

    invalidateCategoriesCache();
    return { ok: true, data: undefined };
}


// ---------------------------------------------------------------------------
// Departamentos (taxonomia organizacional)
// ---------------------------------------------------------------------------

/**
 * Resultado retornado pelas operações de departamento que devolvem a
 * linha completa (`createDepartment`, `updateDepartment`).
 */
export interface DepartmentMutationResult {
    id: string;
    name: string;
}

/**
 * Cria um novo departamento.
 *
 * Pipeline:
 *
 * 1. Verifica `canManageDepartments(actor)`. Falha → `FORBIDDEN`.
 * 2. Valida `rawInput` com `CreateDepartmentSchema`. Falha → `VALIDATION`.
 * 3. INSERT. Conflitos no UNIQUE de `name` retornam `CONFLICT { field: "name" }`.
 * 4. Invalida o cache de departamentos (R15.3).
 *
 * Retorna `{ id, name }` da linha criada para que a Server Action
 * confirme a operação na UI.
 */
export async function createDepartment(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<DepartmentMutationResult>> {
    if (!canManageDepartments(actor)) return forbiddenError();

    const parsed = CreateDepartmentSchema.safeParse(rawInput);
    if (!parsed.success) {
        return validationErrorFromZod(parsed.error.issues[0]);
    }
    const input = parsed.data;

    try {
        const inserted = await db
            .insert(departments)
            .values({ name: input.name })
            .returning({ id: departments.id, name: departments.name });

        const row = inserted[0];
        if (!row) {
            throw new Error(
                "createDepartment: INSERT retornou sem linhas, estado inesperado.",
            );
        }

        invalidateDepartmentsCache();
        return { ok: true, data: { id: row.id, name: row.name } };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe um departamento com esse nome.",
                    field: "name",
                },
            };
        }
        throw err;
    }
}

/**
 * Renomeia um departamento existente.
 *
 * Pipeline:
 *
 * 1. Verifica `canManageDepartments(actor)`. Falha → `FORBIDDEN`.
 * 2. Valida `rawInput` com `UpdateDepartmentSchema` (`id` UUID + `name`
 *    no mesmo intervalo de criação). Falha → `VALIDATION`.
 * 3. UPDATE. Sem linhas → `NOT_FOUND`. Conflito de UNIQUE → `CONFLICT`.
 * 4. Invalida o cache de departamentos.
 */
export async function updateDepartment(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<DepartmentMutationResult>> {
    if (!canManageDepartments(actor)) return forbiddenError();

    const parsed = UpdateDepartmentSchema.safeParse(rawInput);
    if (!parsed.success) {
        return validationErrorFromZod(parsed.error.issues[0]);
    }
    const input = parsed.data;

    try {
        const updated = await db
            .update(departments)
            .set({ name: input.name })
            .where(eq(departments.id, input.id))
            .returning({ id: departments.id, name: departments.name });

        if (updated.length === 0) {
            return {
                ok: false,
                error: {
                    code: "NOT_FOUND",
                    message: "Departamento não encontrado.",
                },
            };
        }

        invalidateDepartmentsCache();
        const row = updated[0]!;
        return { ok: true, data: { id: row.id, name: row.name } };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe um departamento com esse nome.",
                    field: "name",
                },
            };
        }
        throw err;
    }
}

/**
 * Exclui um departamento, rejeitando quando há tickets ou usuários
 * associados.
 *
 * Pipeline (em transação para garantir consistência entre o check e o
 * DELETE, evitando janela em que um ticket/usuário criado simultanemente
 * passa pela checagem inicial):
 *
 * 1. Verifica `canManageDepartments(actor)`. Falha → `FORBIDDEN`.
 * 2. Conta tickets com `department_id = id` e usuários com
 *    `department_id = id`. Se a soma for > 0, aborta com `IN_USE` —
 *    a UI sugere reatribuir antes de excluir.
 * 3. DELETE. Sem linhas → `NOT_FOUND`.
 * 4. Invalida o cache de departamentos.
 *
 * Não realiza cascade: as FKs `tickets.department_id` e
 * `users.department_id` referenciam `departments.id` sem `ON DELETE`
 * explícito, então o próprio Postgres rejeitaria o DELETE — verificar
 * antecipadamente devolve uma mensagem mais útil ao operador e evita
 * depender de mensagens do driver para distinguir `IN_USE` de outras
 * falhas.
 */
export async function deleteDepartment(
    actor: SessionUser,
    id: string,
): Promise<ActionResult<void>> {
    if (!canManageDepartments(actor)) return forbiddenError();

    type DeleteOutcome =
        | { kind: "deleted" }
        | { kind: "not_found" }
        | { kind: "in_use"; tickets: number; users: number };

    const outcome: DeleteOutcome = await db.transaction(async (tx) => {
        const ticketCount = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(tickets)
            .where(eq(tickets.departmentId, id));
        const userCount = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .where(eq(users.departmentId, id));

        const ticketsRefs = ticketCount[0]?.count ?? 0;
        const usersRefs = userCount[0]?.count ?? 0;

        if (ticketsRefs > 0 || usersRefs > 0) {
            return { kind: "in_use", tickets: ticketsRefs, users: usersRefs };
        }

        const deleted = await tx
            .delete(departments)
            .where(eq(departments.id, id))
            .returning({ id: departments.id });

        if (deleted.length === 0) {
            return { kind: "not_found" };
        }
        return { kind: "deleted" };
    });

    if (outcome.kind === "in_use") {
        const parts: string[] = [];
        if (outcome.tickets > 0) {
            parts.push(
                `${outcome.tickets} ${outcome.tickets === 1 ? "ticket" : "tickets"}`,
            );
        }
        if (outcome.users > 0) {
            parts.push(
                `${outcome.users} ${outcome.users === 1 ? "usuário" : "usuários"}`,
            );
        }
        return {
            ok: false,
            error: {
                code: "IN_USE",
                message: `Este departamento possui ${parts.join(" e ")} associados e não pode ser excluído. Reatribua antes de tentar novamente.`,
            },
        };
    }

    if (outcome.kind === "not_found") {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Departamento não encontrado.",
            },
        };
    }

    invalidateDepartmentsCache();
    return { ok: true, data: undefined };
}
