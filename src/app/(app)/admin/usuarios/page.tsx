/**
 * Página `/admin/usuarios` (Server Component).
 *
 * Painel administrativo para gestão de contas e papéis (R14). Carrega
 * uma página de usuários (50 por padrão) com busca textual via query
 * string, e delega a interação para o Client Component
 * `UsersManagement`.
 *
 * Paginação: cursor-based sobre `(name, id)`. O cursor é codificado
 * em base64url e passado pela query (`?cursor=...`). Mais estável que
 * offset porque cadastros novos chegam em tempo real via SSE.
 *
 * Validates: R14.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import {
    listUsersPage,
    type UserListCursor,
} from "@/db/repositories/users.repo";
import { db } from "@/db/client";
import { auth } from "@/lib/auth";
import { canManageUsers } from "@/lib/policies";
import { listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { UsersManagement } from "./users-management";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface UsersPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickFirst(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

/**
 * Decodifica o cursor opaco recebido na URL. Falha silenciosa retorna
 * `undefined` — o caller carrega a primeira página.
 */
function decodeCursor(raw: string | undefined): UserListCursor | undefined {
    if (!raw) return undefined;
    try {
        const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(
            normalized.length + ((4 - (normalized.length % 4)) % 4),
            "=",
        );
        const json = Buffer.from(padded, "base64").toString("utf-8");
        const parsed = JSON.parse(json) as unknown;
        if (
            parsed &&
            typeof parsed === "object" &&
            "name" in parsed &&
            "id" in parsed &&
            typeof (parsed as { name: unknown }).name === "string" &&
            typeof (parsed as { id: unknown }).id === "string"
        ) {
            return parsed as UserListCursor;
        }
    } catch {
        // ignore — fallback to undefined
    }
    return undefined;
}

function encodeCursor(cursor: UserListCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf-8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

export default async function AdminUsersPage({
    searchParams,
}: UsersPageProps) {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    if (!canManageUsers(actor)) {
        redirect("/dashboard");
    }

    const params = await searchParams;
    const q = pickFirst(params.q)?.trim() ?? "";
    const cursor = decodeCursor(pickFirst(params.cursor));

    const [page, departments] = await Promise.all([
        listUsersPage(
            db,
            { ...(q.length > 0 ? { q } : {}) },
            cursor,
            PAGE_SIZE,
        ),
        listDepartments(),
    ]);

    const nextCursorEncoded = page.nextCursor
        ? encodeCursor(page.nextCursor)
        : null;

    return (
        <div>
            <PageHeader
                title="Usuários"
                description="Gestão de contas e papéis"
            />
            <UsersManagement
                users={page.rows}
                departments={departments}
                currentUserId={actor.id}
                currentQuery={q}
                hasPrevious={cursor !== undefined}
                nextCursor={nextCursorEncoded}
            />
        </div>
    );
}
