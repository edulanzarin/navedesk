/**
 * Middleware de autorização do NaveDesk.
 *
 * Executa antes de cada requisição roteada pelo Next.js e funciona como
 * a primeira camada de RBAC do produto: bloqueia rotas autenticadas
 * para visitantes anônimos e isola o painel administrativo dos demais
 * papéis. A revalidação fina das permissões continua ocorrendo nas
 * Server Actions e Route Handlers via `lib/policies.ts` — este
 * middleware apenas evita o trabalho desnecessário (e o vazamento de
 * UI) quando o usuário sequer poderia chegar à página.
 *
 * Regras aplicadas:
 *
 * - Rotas dentro de `(app)` (`/dashboard`, `/tickets`, `/kb`, `/admin`,
 *   `/perfil`) exigem sessão. Sem sessão, redireciona para
 *   `/login?next=<destino>` preservando query string original para que
 *   o pós-login devolva o usuário ao endereço pretendido.
 * - Rotas sob `/admin/*` exigem `role === "admin"`. Usuários
 *   autenticados em outros papéis são redirecionados para `/dashboard`,
 *   atendendo R2.8 (resposta 403 ou redirect).
 *
 * O `matcher` exclui `api/auth` (handlers do NextAuth), assets do Next
 * (`_next/static`, `_next/image`), `favicon.ico` e a própria página
 * `/login`, evitando loops e custo desnecessário.
 *
 * Validates: R1.1, R1.7, R2.8.
 */

import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import authConfig from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

/**
 * Prefixos cobertos pelo grupo de rotas autenticadas `(app)`. Acesso
 * sem sessão sempre redireciona para `/login`.
 */
const PROTECTED_PREFIXES = [
    "/dashboard",
    "/tickets",
    "/kb",
    "/admin",
    "/perfil",
] as const;

/**
 * Subconjunto de rotas restritas a administradores. Solicitantes e
 * técnicos autenticados são desviados para `/dashboard` (R2.8).
 */
const ADMIN_PREFIXES = ["/admin"] as const;

/**
 * Retorna `true` se `path` é igual a `prefix` ou começa com `prefix/`,
 * evitando falsos positivos como `/administrativo` casando com
 * `/admin`.
 */
function matchesPrefix(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(`${prefix}/`);
}

export default auth((req) => {
    const { nextUrl, auth: session } = req;
    const path = nextUrl.pathname;

    const isProtected = PROTECTED_PREFIXES.some((prefix) =>
        matchesPrefix(path, prefix),
    );
    if (!isProtected) {
        return NextResponse.next();
    }

    if (!session) {
        const loginUrl = new URL("/login", nextUrl);
        loginUrl.searchParams.set("next", `${path}${nextUrl.search}`);
        return NextResponse.redirect(loginUrl);
    }

    const isAdminRoute = ADMIN_PREFIXES.some((prefix) =>
        matchesPrefix(path, prefix),
    );
    if (isAdminRoute && session.user?.role !== "admin") {
        return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }

    return NextResponse.next();
});

/**
 * Configuração do matcher do Next.js. Exclui rotas que nunca devem
 * passar pelo middleware (handlers do NextAuth, assets, favicon e a
 * própria tela de login) para evitar loops e custo desnecessário.
 */
export const config = {
    matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
