/**
 * Users service — orquestra autenticação e administração de usuários.
 *
 * Esta camada concentra regras de negócio que envolvem `users`, encapsulando
 * o acesso ao banco via `users.repo` e mantendo as policies/serviços livres
 * de detalhes de persistência. As funções de autenticação recebem o
 * `Database` (ou uma transação) como primeiro parâmetro para permitir
 * composição; as funções administrativas usam o `db` global e devolvem
 * `ActionResult<T>` para uniformizar o contrato com Server Actions.
 *
 * Validates: R1.2, R1.3, R1.5, R14.
 */

import bcrypt from "bcrypt";

import { db, type Database } from "@/db/client";
import {
    findByEmail,
    findById,
    insertUser,
    updateUserActive,
    updateUserAvatar,
    updateUserPassword,
    updateUserRole,
    type UserRow,
} from "@/db/repositories/users.repo";
import { canManageUsers } from "@/lib/policies";
import {
    ChangePasswordSchema,
    CreateUserSchema,
    UpdateAvatarSchema,
} from "@/lib/schemas";
import type { ActionResult, Role, SessionUser } from "@/types/domain";

/**
 * Resultado da verificação de credenciais.
 *
 * Quando `ok=false`, nenhum detalhe adicional é retornado — o consumidor
 * (rota de login) deve renderizar uma mensagem genérica para evitar
 * enumeração de usuários (R1.3).
 */
export interface VerifyPasswordResult {
    ok: boolean;
    user?: SessionUser;
}

/**
 * Verifica par email/senha contra `users`. Retorna `ok=false` para qualquer
 * cenário de falha (usuário inexistente, inativo ou senha incorreta) sem
 * revelar a causa específica, protegendo contra ataques de enumeração.
 *
 * - Compara a senha em texto plano com `users.password_hash` via `bcrypt.compare`
 *   (R1.5 / R14.5).
 * - Recusa autenticação para contas com `active=false` (R1.2).
 * - Devolve um `SessionUser` enxuto (sem hash) quando bem-sucedido, pronto
 *   para ser persistido no token de sessão.
 */
export async function verifyPassword(
    db: Database,
    email: string,
    password: string,
): Promise<VerifyPasswordResult> {
    const row = await findByEmail(db, email);
    if (!row) return { ok: false };
    if (!row.active) return { ok: false };

    const match = await bcrypt.compare(password, row.passwordHash);
    if (!match) return { ok: false };

    return {
        ok: true,
        user: {
            id: row.id,
            email: row.email,
            name: row.name,
            role: row.role,
            departmentId: row.departmentId,
        },
    };
}

/** Custo de hashing usado para senhas (R14.2). */
const BCRYPT_COST = 12;

/**
 * Cria um novo usuário a partir de um payload bruto vindo da borda
 * (Server Action / Route Handler).
 *
 * Pipeline:
 *
 * 1. Valida `rawInput` via `CreateUserSchema.safeParse`. Falha →
 *    `ActionResult.error.code = "VALIDATION_ERROR"` apontando o primeiro
 *    campo inválido (R14.2).
 * 2. Verifica autorização com `canManageUsers(actor)`. Apenas `admin`
 *    pode criar contas — falha → `FORBIDDEN` (R14).
 * 3. Calcula `passwordHash = bcrypt.hash(password, 12)` antes de tocar
 *    no banco, garantindo que a senha em texto plano nunca seja
 *    persistida nem registrada em logs (R14.2).
 * 4. Persiste via `insertUser`. Conflito de email (constraint UNIQUE →
 *    SQLSTATE `23505`) é capturado e devolvido como
 *    `CONFLICT { field: "email" }` (R14.3).
 *
 * Outros erros do driver (FK inválida em `departmentId`, perda de
 * conexão) propagam como exceção para serem mapeados em HTTP 500 pelo
 * caller.
 *
 * Validates: R14.2, R14.3.
 */
export async function createUser(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<UserRow>> {
    const parsed = CreateUserSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".") || undefined;
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                ...(field ? { field } : {}),
            },
        };
    }

    if (!canManageUsers(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode gerenciar usuários.",
            },
        };
    }

    const input = parsed.data;
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    try {
        const row = await insertUser(db, {
            email: input.email,
            name: input.name,
            role: input.role,
            departmentId: input.departmentId,
            passwordHash,
        });
        return { ok: true, data: row };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return {
                ok: false,
                error: {
                    code: "CONFLICT",
                    message: "Já existe um usuário com esse email.",
                    field: "email",
                },
            };
        }
        throw err;
    }
}

/**
 * Desativa um usuário definindo `active=false` sem apagar o registro
 * (R14.4). Contas inativas continuam referenciadas por tickets/eventos
 * históricos, mas o `verifyPassword` impede login (R14.5).
 *
 * - `canManageUsers(actor)` falha → `FORBIDDEN`.
 * - `id` inexistente → `NOT_FOUND`.
 * - Sucesso → linha atualizada (com `active=false`).
 *
 * Validates: R14.4, R14.5.
 */
export async function deactivateUser(
    actor: SessionUser,
    id: string,
): Promise<ActionResult<UserRow>> {
    if (!canManageUsers(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode gerenciar usuários.",
            },
        };
    }

    const row = await updateUserActive(db, id, false);
    if (!row) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Usuário não encontrado.",
            },
        };
    }

    return { ok: true, data: row };
}

/**
 * Atualiza o papel (RBAC) de um usuário (R14.6).
 *
 * A invalidação da sessão atual do alvo na próxima requisição é
 * responsabilidade do middleware Auth.js (que recarrega a sessão a partir
 * do banco); aqui apenas persistimos o novo papel.
 *
 * - `canManageUsers(actor)` falha → `FORBIDDEN`.
 * - `id` inexistente → `NOT_FOUND`.
 * - Sucesso → linha atualizada com o novo `role`.
 *
 * Validates: R14.6.
 */
export async function updateRole(
    actor: SessionUser,
    id: string,
    role: Role,
): Promise<ActionResult<UserRow>> {
    if (!canManageUsers(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Você não pode gerenciar usuários.",
            },
        };
    }

    const row = await updateUserRole(db, id, role);
    if (!row) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Usuário não encontrado.",
            },
        };
    }

    return { ok: true, data: row };
}

/**
 * Troca a senha do próprio usuário autenticado a partir da página
 * `/perfil` (R1.6).
 *
 * Pipeline:
 *
 * 1. Valida `rawInput` via `ChangePasswordSchema.safeParse`. Falhas de
 *    formato (senha curta, confirmação divergente, nova senha igual à
 *    atual) viram `VALIDATION_ERROR` apontando o primeiro campo
 *    inválido.
 * 2. Carrega o registro atual via `findById`. Se o usuário foi
 *    desativado entre o login e a tentativa de troca, recusa com
 *    `FORBIDDEN` — manter o fluxo simétrico ao `verifyPassword` evita
 *    que contas inativas continuem a operar a própria conta.
 * 3. Compara `currentPassword` contra `users.password_hash` via
 *    `bcrypt.compare`. Em caso de divergência, devolve
 *    `INVALID_CREDENTIALS` com mensagem genérica em pt-BR — não
 *    distingue se a senha está errada ou se algo mais aconteceu, em
 *    linha com o tom geral do produto (R20.1).
 * 4. Calcula o novo `passwordHash` com `bcrypt(cost=12)` (mesmo custo
 *    aplicado em `createUser`, R14.2/R14.5) e persiste via
 *    `updateUserPassword`. O retorno mantém o contrato `ActionResult`
 *    sem expor o hash.
 *
 * Não invalidamos a sessão atual — a UI mostra um toast de sucesso e o
 * usuário continua autenticado, alinhado ao fluxo "trocar senha sem
 * deslogar" desejado pelo design.
 *
 * Validates: R1.6.
 */
export async function changePassword(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<null>> {
    const parsed = ChangePasswordSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".") || undefined;
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                ...(field ? { field } : {}),
            },
        };
    }

    const row = await findById(db, actor.id);
    if (!row || !row.active) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message: "Sessão inválida.",
            },
        };
    }

    const currentMatches = await bcrypt.compare(
        parsed.data.currentPassword,
        row.passwordHash,
    );
    if (!currentMatches) {
        return {
            ok: false,
            error: {
                code: "INVALID_CREDENTIALS",
                message: "Senha atual incorreta.",
                field: "currentPassword",
            },
        };
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
    const updated = await updateUserPassword(db, actor.id, newHash);
    if (!updated) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Usuário não encontrado.",
            },
        };
    }

    return { ok: true, data: null };
}

/**
 * Detecta violação de UNIQUE do PostgreSQL (`SQLSTATE 23505`).
 *
 * O `node-postgres` propaga o erro com a propriedade `code` igual ao
 * SQLSTATE; o Drizzle não embrulha a exceção, então o `instanceof Error`
 * basta para o type narrowing seguro sem importar `pg.DatabaseError`
 * (evita acoplamento direto ao pacote no serviço).
 */
function isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && code === "23505";
}


/**
 * Atualiza a aparência do avatar do usuário autenticado (R1.6).
 *
 * Pipeline:
 *
 * 1. Valida `rawInput` com `UpdateAvatarSchema`. Falha → `VALIDATION_ERROR`.
 * 2. Persiste via `updateUserAvatar(actor.id, …)`. Strings vazias para
 *    `avatarUrl` são normalizadas como `null` (remoção da foto).
 * 3. Retorna a linha atualizada para que a UI atualize o avatar
 *    imediatamente.
 *
 * Não invalida cache (não usamos cache em `users`); a próxima
 * navegação carrega o estado fresco direto do banco.
 *
 * Validates: R1.6.
 */
export async function updateAvatar(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<UserRow>> {
    const parsed = UpdateAvatarSchema.safeParse(rawInput);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
            ok: false,
            error: {
                code: "VALIDATION_ERROR",
                message: issue?.message ?? "Dados inválidos.",
                ...(issue?.path?.length
                    ? { field: String(issue.path.join(".")) }
                    : {}),
            },
        };
    }

    const { color, avatarUrl } = parsed.data;
    const patch: { avatarColor?: string; avatarUrl?: string | null } = {};
    if (color !== undefined) patch.avatarColor = color;
    if (avatarUrl !== undefined) {
        patch.avatarUrl = avatarUrl === "" ? null : avatarUrl;
    }

    const updated = await updateUserAvatar(db, actor.id, patch);
    if (!updated) {
        return {
            ok: false,
            error: {
                code: "NOT_FOUND",
                message: "Usuário não encontrado.",
            },
        };
    }

    return { ok: true, data: updated };
}
