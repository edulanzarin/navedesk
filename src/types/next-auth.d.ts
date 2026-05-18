/**
 * Augmentações de tipo para `next-auth` e `@auth/core/jwt`.
 *
 * Acrescenta os campos de domínio do Navedesk (`id`, `role`,
 * `departmentId`, `avatarColor`, `avatarUrl`) ao `User`, à
 * `Session.user` e ao `JWT`, de forma que Server Components, Server
 * Actions e o Topbar/Sidebar consumam `auth()` sem precisar fazer
 * cast manual ou ir buscar dados de aparência no banco.
 *
 * Validates: R1.6.
 */

import type { Role } from "@/types/domain";

declare module "next-auth" {
    /**
     * Objeto retornado por `authorize` no provedor Credentials.
     */
    interface User {
        id: string;
        email: string;
        name: string;
        role: Role;
        departmentId: string | null;
        avatarColor: string;
        avatarUrl: string | null;
    }

    /**
     * Sessão exposta a Server Components via `auth()`.
     */
    interface Session {
        user: {
            id: string;
            email: string;
            name: string;
            role: Role;
            departmentId: string | null;
            avatarColor: string;
            avatarUrl: string | null;
        };
    }
}

declare module "@auth/core/jwt" {
    interface JWT {
        id: string;
        role: Role;
        departmentId: string | null;
        avatarColor: string;
        avatarUrl: string | null;
    }
}

export { };
