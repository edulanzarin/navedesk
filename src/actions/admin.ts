/**
 * Server Actions administrativas do NaveDesk.
 *
 * Camada fina entre os formulários de `/admin/*` e os serviços
 * `users.service` e `admin.service`. Cada action segue o mesmo
 * pipeline:
 *
 * 1. Recupera a sessão via `auth()`. Sem sessão válida → `UNAUTHORIZED`
 *    sem invocar o serviço (defesa em profundidade — middleware já
 *    bloqueia rotas `/admin/*` para não-autenticados, mas Server Actions
 *    podem ser chamadas diretamente via fetch).
 * 2. Delega para o serviço correspondente, que aplica autorização RBAC
 *    (`canManageUsers`, `canManageSla`, `canManageCategories`) e devolve
 *    `ActionResult<T>`.
 * 3. Em sucesso, chama `revalidatePath` para a rota administrativa
 *    afetada, garantindo que a próxima navegação reflita o novo estado
 *    sem precisar recarregar manualmente.
 *
 * Mensagens de erro vêm do serviço — esta camada não interpreta nem
 * remapeia códigos para preservar o contrato `ActionResult` esperado
 * pelo cliente.
 *
 * Validates: R14, R15.
 */

"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import * as adminService from "@/services/admin.service";
import * as usersService from "@/services/users.service";
import type { UserRow } from "@/db/repositories/users.repo";
import type { ActionResult, Priority, Role, SessionUser } from "@/types/domain";

/**
 * Recupera o usuário autenticado da sessão atual ou `null` se a
 * requisição é anônima/expirada. Mantemos a lógica isolada para que
 * cada action faça apenas uma chamada e seja fácil de testar.
 */
async function requireSession(): Promise<SessionUser | null> {
    const session = await auth();
    return (session?.user as SessionUser | undefined) ?? null;
}

/**
 * `ActionResult` compartilhado para erro `UNAUTHORIZED` (sessão ausente
 * ou inválida). Os checks de papel ficam a cargo do serviço para
 * centralizar policies em um único lugar.
 */
function unauthorized(): ActionResult<never> {
    return {
        ok: false,
        error: {
            code: "UNAUTHORIZED",
            message: "Sessão inválida.",
        },
    };
}

/**
 * Cria um usuário novo a partir do formulário de `/admin/usuarios`
 * (R14.2, R14.3). O serviço valida o payload com Zod, verifica papel
 * `admin` e gera o `passwordHash`. Em sucesso, revalida a listagem.
 */
export async function createUserAction(
    rawInput: unknown,
): Promise<ActionResult<UserRow>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await usersService.createUser(actor, rawInput);
    if (result.ok) revalidatePath("/admin/usuarios");
    return result;
}

/**
 * Desativa um usuário (`active=false`) sem apagar o registro (R14.4).
 * Mantém o histórico de tickets/eventos que referenciam a conta.
 */
export async function deactivateUserAction(
    id: string,
): Promise<ActionResult<UserRow>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await usersService.deactivateUser(actor, id);
    if (result.ok) revalidatePath("/admin/usuarios");
    return result;
}

/**
 * Atualiza o papel (RBAC) de um usuário (R14.6). A invalidação da
 * sessão ativa do alvo é responsabilidade do middleware Auth.js, que
 * recarrega claims a partir do banco.
 */
export async function updateUserRoleAction(
    id: string,
    role: Role,
): Promise<ActionResult<UserRow>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await usersService.updateRole(actor, id, role);
    if (result.ok) revalidatePath("/admin/usuarios");
    return result;
}

/**
 * Atualiza a Politica_SLA de uma prioridade (R15.2, R15.3). Tickets
 * existentes preservam seu `slaDeadline` (R6.10) — a nova janela vale
 * apenas para tickets futuros. O serviço já invalida o cache de
 * políticas; aqui revalidamos a página administrativa.
 */
export async function updateSlaPolicyAction(
    rawInput: unknown,
): Promise<ActionResult<{ priority: Priority; minutes: number }>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.updateSlaPolicy(actor, rawInput);
    if (result.ok) revalidatePath("/admin/sla");
    return result;
}

/**
 * Cria uma nova Categoria de chamado (R15.5). Conflitos de `id`
 * existente vêm como `CONFLICT { field: "id" }` do serviço.
 */
export async function createCategoryAction(
    rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.createCategory(actor, rawInput);
    if (result.ok) revalidatePath("/admin/categorias");
    return result;
}

/**
 * Marca uma Categoria como inativa (R15.6). Categorias desativadas
 * saem dos formulários de abertura sem afetar tickets já existentes
 * que as referenciam.
 */
export async function deactivateCategoryAction(
    id: string,
): Promise<ActionResult<void>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.deactivateCategory(actor, id);
    if (result.ok) revalidatePath("/admin/categorias");
    return result;
}

/**
 * Exclui uma Categoria, rejeitando quando há tickets associados (R15.7).
 *
 * O serviço retorna `IN_USE` com mensagem em pt-BR quando a categoria
 * está referenciada por algum ticket — a UI deve exibir a mensagem
 * sugerindo desativação como alternativa. Outros erros possíveis:
 * `FORBIDDEN` (não-admin) e `NOT_FOUND` (id inexistente).
 */
export async function deleteCategoryAction(
    id: string,
): Promise<ActionResult<void>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.deleteCategory(actor, id);
    if (result.ok) revalidatePath("/admin/categorias");
    return result;
}

/**
 * Cria um novo departamento. Conflitos no UNIQUE de `name` voltam como
 * `CONFLICT { field: "name" }` para o formulário sinalizar.
 *
 * Após sucesso revalida `/admin/departamentos`. Como departamentos
 * também aparecem em selects da listagem de tickets e do formulário
 * de novo ticket, qualquer leitura desses pontos vai pela rota cacheada
 * `listDepartments()` — o serviço já invalida esse cache, então a
 * próxima navegação reflete o novo departamento sem revalidações
 * adicionais aqui.
 */
export async function createDepartmentAction(
    rawInput: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.createDepartment(actor, rawInput);
    if (result.ok) revalidatePath("/admin/departamentos");
    return result;
}

/**
 * Renomeia um departamento existente. Mesmas regras de conflito da
 * criação.
 */
export async function updateDepartmentAction(
    rawInput: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.updateDepartment(actor, rawInput);
    if (result.ok) revalidatePath("/admin/departamentos");
    return result;
}

/**
 * Exclui um departamento, rejeitando quando há tickets ou usuários
 * associados (`IN_USE`). A mensagem do serviço já orienta a reatribuir
 * antes de excluir.
 */
export async function deleteDepartmentAction(
    id: string,
): Promise<ActionResult<void>> {
    const actor = await requireSession();
    if (!actor) return unauthorized();

    const result = await adminService.deleteDepartment(actor, id);
    if (result.ok) revalidatePath("/admin/departamentos");
    return result;
}
