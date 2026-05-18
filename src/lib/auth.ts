/**
 * Configuração do Auth.js (NextAuth v5) para o NaveDesk.
 *
 * Define um único provedor `Credentials` que valida `email`/`password`
 * contra a tabela `users` (hash bcrypt + flag `active`). A sessão é
 * stateless (`strategy: "jwt"`) e o cookie é HttpOnly + SameSite=Lax,
 * com `secure` ativado em produção.
 *
 * O JWT carrega `id`, `role` e `departmentId` do usuário; a sessão
 * exposta em Server Components — via o helper `auth()` re-exportado
 * abaixo — espelha esses campos sob `session.user`.
 *
 * As partes Edge-safe (callbacks, cookies, sessão) vivem em
 * `auth.config.ts` e são compartilhadas com o middleware. Aqui ficam
 * apenas dependências de runtime Node (bcrypt, driver `pg`).
 *
 * Validates: R1.4, R1.6, R1.7.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { z } from "zod";

import authConfig from "./auth.config";
import { db } from "@/db/client";
import { findByEmail } from "@/db/repositories/users.repo";
import type { Role } from "@/types/domain";

/**
 * Schema mínimo para o payload bruto vindo do formulário de login.
 *
 * Falhas de parsing devolvem `null` no `authorize`, evitando vazar para
 * o cliente se o problema é no e-mail, na senha ou nas credenciais como
 * um todo (vide R1.3).
 */
const CredentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const {
    handlers,
    auth,
    signIn,
    signOut,
    unstable_update: updateSession,
} = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "Credentials",
            credentials: {
                email: { label: "E-mail", type: "email" },
                password: { label: "Senha", type: "password" },
            },
            async authorize(rawCredentials) {
                const parsed = CredentialsSchema.safeParse(rawCredentials);
                if (!parsed.success) {
                    return null;
                }

                const user = await findByEmail(db, parsed.data.email);
                if (!user || !user.active) {
                    return null;
                }

                const passwordOk = await bcrypt.compare(
                    parsed.data.password,
                    user.passwordHash,
                );
                if (!passwordOk) {
                    return null;
                }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role as Role,
                    departmentId: user.departmentId,
                    avatarColor: user.avatarColor,
                    avatarUrl: user.avatarUrl,
                };
            },
        }),
    ],
});
