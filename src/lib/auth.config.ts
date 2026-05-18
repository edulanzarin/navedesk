/**
 * Configuração base do Auth.js (NextAuth v5) compatível com Edge Runtime.
 *
 * Este arquivo concentra apenas o que pode rodar no middleware do
 * Next.js (Edge): callbacks que lêem o JWT, configuração de sessão,
 * páginas, segredo e cookies. O provedor `Credentials` — que depende
 * de `bcrypt` e do driver `pg` (módulos nativos do Node) — fica em
 * `auth.ts`, que estende este objeto e roda exclusivamente no runtime
 * Node.
 *
 * O split segue o padrão recomendado pelo Auth.js v5 para evitar que o
 * bundler do Next tente empacotar dependências nativas no bundle do
 * middleware (ver `Module not found: Can't resolve 'pg-native'`).
 */

import type { NextAuthConfig } from "next-auth";

import type { Role } from "@/types/domain";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Quando o app roda em produção mas é servido por HTTP puro (típico de
 * deploy interno em rede LAN sem certificado TLS), os cookies com
 * prefixo `__Secure-` e flag `secure: true` são silenciosamente
 * descartados pelo navegador, fazendo com que o login "funcione" mas
 * a sessão não seja persistida — usuário fica em loop de redirect.
 *
 * Setar `AUTH_INSECURE_COOKIES=true` no `.env` desativa o `secure` e
 * usa o nome de cookie sem prefixo, permitindo HTTP em LAN. Em deploy
 * com HTTPS válido, deixe a variável ausente para manter o cookie
 * seguro.
 */
const useInsecureCookies =
    process.env.AUTH_INSECURE_COOKIES === "true";

const cookieIsSecure = isProduction && !useInsecureCookies;

export default {
    session: { strategy: "jwt" },
    pages: { signIn: "/login" },
    secret: process.env.AUTH_SECRET,
    providers: [],
    callbacks: {
        /**
         * Atualiza o token em três momentos:
         *
         * 1. **Login** (`user` presente) — `authorize` no `auth.ts`
         *    devolve o `User` com todos os campos de domínio; copiamos
         *    para o token para que o Edge Runtime do middleware
         *    consiga ler sem ir ao banco.
         *
         * 2. **`update()` chamado pelo cliente** (`trigger === "update"`,
         *    com `session` carregando o patch) — quando o usuário
         *    troca a foto/cor em `/perfil`, o componente cliente
         *    chama `useSession().update({ user: { avatarColor,
         *    avatarUrl } })`. Mesclamos esses campos no token aqui
         *    para que a próxima leitura de `auth()` reflita a
         *    aparência nova **sem** precisar de logout/login.
         *
         * 3. **Demais requests** — apenas devolve o token como veio,
         *    preservando o estado.
         */
        jwt({ token, user, trigger, session }) {
            if (user) {
                token.id = (user as { id: string }).id;
                token.role = (user as { role: Role }).role;
                token.departmentId =
                    (user as { departmentId: string | null }).departmentId ??
                    null;
                token.avatarColor =
                    (user as { avatarColor?: string }).avatarColor ??
                    "#5E5CE6";
                token.avatarUrl =
                    (user as { avatarUrl?: string | null }).avatarUrl ??
                    null;
            }

            // Patch via `useSession().update(...)`.
            if (
                trigger === "update" &&
                session &&
                typeof session === "object"
            ) {
                const patch = (session as { user?: Record<string, unknown> })
                    .user;
                if (patch) {
                    if (typeof patch.avatarColor === "string") {
                        token.avatarColor = patch.avatarColor;
                    }
                    if (
                        typeof patch.avatarUrl === "string" ||
                        patch.avatarUrl === null
                    ) {
                        token.avatarUrl = patch.avatarUrl as string | null;
                    }
                    if (typeof patch.name === "string") {
                        token.name = patch.name;
                    }
                }
            }

            return token;
        },
        session({ session, token }) {
            if (session.user) {
                session.user.id = (token.id as string) ?? session.user.id;
                session.user.role = token.role as Role;
                session.user.departmentId =
                    (token.departmentId as string | null) ?? null;
                session.user.avatarColor =
                    (token.avatarColor as string | undefined) ?? "#5E5CE6";
                session.user.avatarUrl =
                    (token.avatarUrl as string | null | undefined) ?? null;
            }
            return session;
        },
    },
    cookies: {
        sessionToken: {
            name: cookieIsSecure
                ? "__Secure-next-auth.session-token"
                : "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: cookieIsSecure,
            },
        },
    },
} satisfies NextAuthConfig;
