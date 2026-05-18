/**
 * Server Actions de autenticação do NaveDesk.
 *
 * Expõe duas operações:
 *
 * - `loginAction` — invocada pelo `LoginForm` (Client Component); aplica o
 *   rate limit oficial (`LOGIN_RATE_LIMIT`: 10 req/min/IP, R1.9) antes de
 *   chamar `signIn` do Auth.js. O IP é resolvido a partir dos cabeçalhos
 *   `x-forwarded-for` / `x-real-ip` injetados pelo proxy reverso. Em caso
 *   de credenciais inválidas, devolve uma mensagem genérica em pt-BR sem
 *   distinguir email inexistente, senha errada ou usuário inativo
 *   (R1.3, R1.5, R20.1).
 * - `logoutAction` — invalida a sessão e redireciona para `/login` (R1.8).
 *
 * Validates: R1.1, R1.3, R1.4, R1.5, R1.8, R1.9, R20.1.
 */

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { AuthError } from "next-auth";

import { auth, signIn, signOut, updateSession } from "@/lib/auth";
import { LOGIN_RATE_LIMIT, loginRateLimiter } from "@/lib/rate-limit";
import * as usersService from "@/services/users.service";
import type { ActionResult, SessionUser } from "@/types/domain";

/**
 * Mensagem genérica retornada para qualquer falha de autenticação.
 * Não revela se o problema é o email, a senha ou o status `active`
 * do usuário, mitigando enumeração de contas (R1.3).
 */
const GENERIC_AUTH_ERROR = "E-mail ou senha incorretos.";

/**
 * Mensagem usada quando o rate limit por IP é estourado.
 */
const RATE_LIMITED_MESSAGE =
    "Muitas tentativas de login. Aguarde um instante e tente novamente.";

/**
 * Resolve o endereço IP do cliente a partir dos cabeçalhos da
 * requisição corrente do Server Action.
 *
 * `next/headers().headers()` expõe os cabeçalhos forward-ados pelo
 * Next; em ambientes atrás de proxy (compose, ngrok, Vercel) o IP do
 * cliente vem em `x-forwarded-for` (separado por vírgula) ou
 * `x-real-ip`. Quando nenhum dos dois está presente — caso típico de
 * teste local sem proxy — caímos no literal `"unknown"`, agrupando
 * essas requisições no mesmo bucket de rate limit.
 */
async function resolveClientIp(): Promise<string> {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    if (forwardedFor) {
        const first = forwardedFor.split(",")[0]?.trim();
        if (first) return first;
    }
    const realIp = h.get("x-real-ip");
    if (realIp && realIp.trim().length > 0) return realIp.trim();
    return "unknown";
}

/**
 * Payload aceito por `loginAction`. O schema completo é validado no
 * cliente via `react-hook-form` + Zod; aqui usamos apenas `string`
 * porque o servidor não confia nem rejeita por motivo específico —
 * qualquer dado inválido cai na mesma resposta genérica do Auth.js.
 */
export interface LoginInput {
    email: string;
    password: string;
}

/**
 * Server Action que processa o submit do formulário de `/login`.
 *
 * Etapas:
 *
 * 1. Resolve o IP do cliente e consulta `loginRateLimiter.check`. Se a
 *    janela atual estourou o limite, retorna `RATE_LIMITED` sem chamar
 *    o Auth.js — protege o `bcrypt.compare` (custoso) contra brute force
 *    (R1.9).
 * 2. Chama `signIn("credentials", { ..., redirect: false })`. Com
 *    `redirect: false`, o Auth.js v5 grava o cookie de sessão na
 *    resposta do Server Action e devolve a URL de destino, sem disparar
 *    redirect HTTP — assim o cliente pode usar `router.push(next)` para
 *    levar o usuário ao destino preservado em `?next=` (R1.4).
 * 3. Em caso de erro, devolve uma mensagem **genérica** em pt-BR. Toda
 *    falha do provedor `Credentials` (email inexistente, senha errada,
 *    usuário inativo) descende de `AuthError`; tratamos como o mesmo
 *    erro para não vazar detalhes (R1.3, R1.5, R20.1). Erros não
 *    relacionados a auth são re-lançados para que o Next devolva 500.
 *
 * Não chamamos `revalidatePath` aqui: a navegação subsequente é feita
 * pelo cliente via `router.push`/`router.refresh`, e o `auth()` em
 * Server Components já lê o cookie atualizado.
 *
 * Validates: R1.3, R1.4, R1.5, R1.9, R20.1.
 */
export async function loginAction(
    input: LoginInput,
): Promise<ActionResult<null>> {
    const ip = await resolveClientIp();
    const rate = loginRateLimiter.check(`login:${ip}`, LOGIN_RATE_LIMIT);
    if (!rate.allowed) {
        return {
            ok: false,
            error: {
                code: "RATE_LIMITED",
                message: RATE_LIMITED_MESSAGE,
            },
        };
    }

    try {
        await signIn("credentials", {
            email: input.email,
            password: input.password,
            redirect: false,
        });
        return { ok: true, data: null };
    } catch (err) {
        if (err instanceof AuthError) {
            return {
                ok: false,
                error: {
                    code: "INVALID_CREDENTIALS",
                    message: GENERIC_AUTH_ERROR,
                },
            };
        }
        throw err;
    }
}

export async function logoutAction(): Promise<void> {
    await signOut({ redirectTo: "/login" });
}

/**
 * Server Action que troca a senha do próprio usuário autenticado a partir
 * da página `/perfil` (R1.6).
 *
 * Pipeline:
 *
 * 1. Recupera a sessão via `auth()`. Sem sessão → `UNAUTHORIZED` antes
 *    mesmo de tocar no serviço (defesa em profundidade — middleware já
 *    bloqueia rotas autenticadas, mas Server Actions podem ser chamadas
 *    diretamente).
 * 2. Delega para `users.service.changePassword`, que valida o payload
 *    com Zod, compara `currentPassword` via `bcrypt.compare` e persiste
 *    o novo hash com `bcrypt(cost=12)`.
 *
 * Não chamamos `revalidatePath` porque a página de perfil exibe apenas
 * dados do usuário corrente (que não mudam após a troca de senha) — o
 * Client Component limpa o formulário e mostra um toast em sucesso.
 *
 * Validates: R1.6.
 */
export async function changePasswordAction(
    rawInput: unknown,
): Promise<ActionResult<null>> {
    const session = await auth();
    const actor = (session?.user as SessionUser | undefined) ?? null;
    if (!actor) {
        return {
            ok: false,
            error: {
                code: "UNAUTHORIZED",
                message: "Sessão inválida.",
            },
        };
    }

    return usersService.changePassword(actor, rawInput);
}
/**
 * Atualiza a aparência do avatar do usuário autenticado (cor e/ou
 * foto) — usada pela página `/perfil` (R1.6).
 *
 * Pipeline padrão: `auth()` para garantir sessão, delega ao serviço
 * que aplica validação Zod + persistência. Em sucesso revalida
 * `/perfil` para que a próxima navegação busque o estado fresco e os
 * componentes que consomem `users.avatar_color`/`avatar_url` (sidebar,
 * topbar, mensagens) reflitam a mudança.
 *
 * Validates: R1.6.
 */
export async function updateAvatarAction(
    rawInput: unknown,
): Promise<ActionResult<{ avatarColor: string; avatarUrl: string | null }>> {
    const session = await auth();
    const actor = (session?.user as SessionUser | undefined) ?? null;
    if (!actor) {
        return {
            ok: false,
            error: {
                code: "UNAUTHORIZED",
                message: "Sessão inválida.",
            },
        };
    }

    const result = await usersService.updateAvatar(actor, rawInput);
    if (result.ok) {
        // Mescla os campos novos no JWT da sessão atual para que
        // Topbar, Sidebar e demais Server Components que leem
        // `auth()` reflitam a nova aparência sem exigir
        // logout/login. O callback `jwt` em `auth.config.ts`
        // recebe `trigger === "update"` e copia o patch para o
        // token.
        await updateSession({
            user: {
                avatarColor: result.data.avatarColor,
                avatarUrl: result.data.avatarUrl ?? null,
            },
        });
        revalidatePath("/perfil");
        revalidatePath("/", "layout");
        return {
            ok: true,
            data: {
                avatarColor: result.data.avatarColor,
                avatarUrl: result.data.avatarUrl ?? null,
            },
        };
    }
    return result;
}
