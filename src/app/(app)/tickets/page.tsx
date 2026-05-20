/**
 * Página `/tickets` (Server Component).
 *
 * Lista paginada de tickets com filtros e ordenação derivados da query
 * string. Toda a leitura é servida pelo `tickets.repo.listWithFilters`,
 * que já aplica:
 *
 * - **RBAC implícito** para solicitantes (`requesterId = user.id`),
 *   independentemente do que vier em `?requesterId=` (R11.4).
 * - **Paginação cursor-based** sobre `(updated_at, id)` com janela default
 *   de 50 linhas e suporte a `cursor` opaco (R11.1, R11.5).
 * - **Filtros** por `status`, `priority`, `categoryId`, `departmentId`,
 *   `assignee` (UUID, `me` ou `none`), `requesterId` e busca textual `q`
 *   em `title` ou `id` (R11.2, R11.3).
 * - **Ordenação** default `updated_at DESC`; alternativas `createdAt`,
 *   `priority` e `slaDeadline` em qualquer direção (R11.5).
 *
 * Enriquecimento dos dados — `TicketRowData` exige campos textuais
 * resolvidos no servidor (categoria, departamento, solicitante,
 * responsável). Este RSC monta os mapas auxiliares em paralelo:
 *
 * - `categories` e `departments` via `reads.service` (cache TTL 60s).
 * - `users` em uma única query `inArray(users.id, ...)` cobrindo todos
 *   os solicitantes e responsáveis distintos da página corrente —
 *   evita N+1.
 *
 * O componente é puro RSC: nenhum `"use client"`, nenhum hook. Filtros
 * interativos chegam na task 20.2 com o componente cliente
 * `TicketsFilterBar`. A barra atual é apenas um placeholder visual com
 * resumo dos filtros aplicados, suficiente para inspeção e para que a
 * navegação por links continue funcionando.
 *
 * Validates: R11.1, R11.2, R11.3, R11.4, R11.5.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { inArray } from "drizzle-orm";
import { Plus } from "lucide-react";

import { type TicketRowData } from "@/components/domain/ticket-row";
import { TicketsDataTable } from "@/components/domain/tickets-data-table";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import {
    listWithFilters,
    type ListFilters,
    type TicketListCursor,
} from "@/db/repositories/tickets.repo";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
    PRIORITIES,
    STATUSES,
    type Priority,
    type TicketStatus,
} from "@/lib/constants";
import {
    getAllSlaPolicies,
    listCategories,
    listDepartments,
} from "@/services/reads.service";
import type { SessionUser, Ticket } from "@/types/domain";

import { TicketsFilterBar } from "./tickets-filter-bar";

/**
 * Em Next 15 `searchParams` é uma `Promise` que precisa ser `await`-ada
 * antes do uso (ver `(auth)/login/page.tsx` para o mesmo padrão).
 */
type SearchParamsBag = Record<string, string | string[] | undefined>;

interface TicketsPageProps {
    searchParams: Promise<SearchParamsBag>;
}

/** Tamanho de página default. Coerente com R11.1 e o limit do repo. */
const PAGE_LIMIT = 50;

/** Conjuntos válidos para `sortBy` e `sortDir`. */
const SORT_BY = ["updatedAt", "createdAt", "priority", "slaDeadline"] as const;
const SORT_DIR = ["asc", "desc"] as const;

type SortByValue = (typeof SORT_BY)[number];
type SortDirValue = (typeof SORT_DIR)[number];

/**
 * Reduz um `searchParam` (que pode ser `string | string[] | undefined`)
 * ao primeiro valor não-vazio. `URLSearchParams` permite chaves repetidas
 * mas para esta página só faz sentido o primeiro — filtros são
 * single-valued.
 */
function pickFirst(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

/**
 * Restringe uma string ao conjunto literal informado, devolvendo
 * `undefined` quando o valor não pertence ao conjunto. Isso protege os
 * filtros vindos da URL contra valores arbitrários sem precisar lançar
 * 400 — basta ignorar o filtro inválido e continuar listando.
 */
function asLiteral<T extends readonly string[]>(
    raw: string | undefined,
    allowed: T,
): T[number] | undefined {
    if (raw === undefined) return undefined;
    return (allowed as readonly string[]).includes(raw)
        ? (raw as T[number])
        : undefined;
}

/**
 * Decodifica o cursor opaco recebido na URL.
 *
 * O cursor é `base64url(JSON.stringify({ updatedAt, id }))`. Em qualquer
 * falha (base64 inválido, JSON inválido, formato divergente) devolvemos
 * `undefined` — o repositório então lista a primeira página, que é o
 * comportamento esperado quando o cliente recarrega com cursor expirado.
 */
function decodeCursor(raw: string | undefined): TicketListCursor | undefined {
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
            "updatedAt" in parsed &&
            "id" in parsed &&
            typeof (parsed as { updatedAt: unknown }).updatedAt === "string" &&
            typeof (parsed as { id: unknown }).id === "string"
        ) {
            return parsed as TicketListCursor;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Codifica o cursor em formato `base64url` para uso seguro em URLs.
 */
function encodeCursor(cursor: TicketListCursor): string {
    const json = JSON.stringify(cursor);
    return Buffer.from(json, "utf-8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

/**
 * Resolve o filtro de `assignee` recebido na URL para o tipo aceito
 * pelo repositório:
 *
 * - `me`     → string `"me"` (o repo resolve para `user.id`).
 * - `none`   → `null` (`assignee_id IS NULL`).
 * - `<uuid>` → string crua.
 * - vazio    → `undefined` (sem filtro).
 *
 * `none` é o valor exposto pela `Sidebar` no link "Sem responsável"
 * (`/tickets?assignee=none`), garantindo que o atalho funcione direto.
 */
function parseAssigneeFilter(
    raw: string | undefined,
): ListFilters["assigneeId"] {
    if (raw === undefined || raw.length === 0) return undefined;
    if (raw === "me") return "me";
    if (raw === "none") return null;
    return raw;
}

/**
 * Constrói os `ListFilters` a partir da query string já normalizada.
 * Mantém-se em uma função pura para facilitar a inspeção e evitar
 * espalhar lógica de parsing pelo componente.
 */
function buildFilters(params: SearchParamsBag): ListFilters {
    const status = asLiteral(pickFirst(params.status), STATUSES) as
        | TicketStatus
        | undefined;
    const priority = asLiteral(pickFirst(params.priority), PRIORITIES) as
        | Priority
        | undefined;
    const sortBy = asLiteral<typeof SORT_BY>(pickFirst(params.sort), SORT_BY) as
        | SortByValue
        | undefined;
    const sortDir = asLiteral<typeof SORT_DIR>(
        pickFirst(params.dir),
        SORT_DIR,
    ) as SortDirValue | undefined;

    const categoryId = pickFirst(params.categoryId);
    const departmentId = pickFirst(params.departmentId);
    const requesterId = pickFirst(params.requesterId);
    const q = pickFirst(params.q);
    const assignee = parseAssigneeFilter(pickFirst(params.assignee));
    const cursor = decodeCursor(pickFirst(params.cursor));

    return {
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(categoryId !== undefined && categoryId.length > 0
            ? { categoryId }
            : {}),
        ...(departmentId !== undefined && departmentId.length > 0
            ? { departmentId }
            : {}),
        ...(assignee !== undefined ? { assigneeId: assignee } : {}),
        ...(requesterId !== undefined && requesterId.length > 0
            ? { requesterId }
            : {}),
        ...(q !== undefined && q.trim().length > 0 ? { q: q.trim() } : {}),
        ...(sortBy !== undefined ? { sortBy } : {}),
        ...(sortDir !== undefined ? { sortDir } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        limit: PAGE_LIMIT,
    };
}

/**
 * Reconstrói a URL `/tickets?...` preservando os filtros atuais e
 * substituindo apenas o `cursor` pelo valor informado (usado pelo link
 * "Próxima página"). Aceita `null` para limpar o cursor — útil para um
 * eventual link "voltar ao início".
 */
function buildHref(
    params: SearchParamsBag,
    overrides: { cursor?: string | null },
): string {
    const sp = new URLSearchParams();
    for (const [key, raw] of Object.entries(params)) {
        if (key === "cursor") continue;
        const value = pickFirst(raw);
        if (value !== undefined && value.length > 0) {
            sp.set(key, value);
        }
    }
    if (overrides.cursor) {
        sp.set("cursor", overrides.cursor);
    }
    const qs = sp.toString();
    return qs.length > 0 ? `/tickets?${qs}` : "/tickets";
}

/**
 * Monta o array de `TicketRowData` a partir das linhas do repositório
 * usando os mapas auxiliares pré-carregados.
 *
 * Quando uma referência (categoria, departamento, usuário) não é
 * encontrada — o que indica um inconsistência entre tabelas — caímos
 * para um valor textual seguro (`id` cru ou `"—"`) em vez de quebrar a
 * página, alinhado ao R22.1 (mensagens de erro amigáveis).
 */
function enrichRows(
    rows: Ticket[],
    categoryById: Map<
        string,
        { label: string; sub: string; icon: string }
    >,
    departmentById: Map<string, { name: string }>,
    userById: Map<
        string,
        { name: string; avatarColor: string; avatarUrl: string | null }
    >,
): TicketRowData[] {
    return rows.map((ticket) => {
        const cat = categoryById.get(ticket.categoryId);
        const dept = departmentById.get(ticket.departmentId);
        const requester = userById.get(ticket.requesterId);
        const assignee = ticket.assigneeId
            ? userById.get(ticket.assigneeId)
            : undefined;

        return {
            id: ticket.id,
            title: ticket.title,
            status: ticket.status,
            priority: ticket.priority,
            categoryIcon: cat?.icon ?? "tag",
            categoryLabel: cat?.label ?? ticket.categoryId,
            ...(cat?.sub ? { categorySub: cat.sub } : {}),
            requesterName: requester?.name ?? "—",
            ...(requester?.avatarColor
                ? { requesterAvatarColor: requester.avatarColor }
                : {}),
            ...(requester?.avatarUrl
                ? { requesterAvatarUrl: requester.avatarUrl }
                : {}),
            assigneeName: assignee ? assignee.name : null,
            ...(assignee?.avatarColor
                ? { assigneeAvatarColor: assignee.avatarColor }
                : {}),
            ...(assignee?.avatarUrl
                ? { assigneeAvatarUrl: assignee.avatarUrl }
                : {}),
            ...(dept?.name ? { departmentLabel: dept.name } : {}),
            slaDeadline: ticket.slaDeadline,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
        };
    });
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
    // Defesa em profundidade — middleware já bloqueia anônimos, mas o
    // redirect explícito garante que nenhum bloco abaixo execute sem
    // `session.user` populado (R1.1, R1.7).
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    const params = await searchParams;
    const filters = buildFilters(params);

    // Leituras estáveis em paralelo: políticas de SLA, taxonomias e a
    // própria página de tickets. Cada uma é cacheada em memória (TTL 60s)
    // pelo `reads.service` para reduzir latência em navegações sucessivas.
    const [policies, categories, departments, page] = await Promise.all([
        getAllSlaPolicies(),
        listCategories(),
        listDepartments(),
        listWithFilters(db, user, filters),
    ]);

    // Resolve nomes de solicitantes e responsáveis em uma única query
    // por chave primária. Conjunto montado a partir das linhas da página
    // corrente para evitar N+1 sem trazer toda a tabela `users`.
    const userIds = new Set<string>();
    for (const ticket of page.rows) {
        userIds.add(ticket.requesterId);
        if (ticket.assigneeId) userIds.add(ticket.assigneeId);
    }
    const userRows =
        userIds.size > 0
            ? await db
                .select({
                    id: users.id,
                    name: users.name,
                    avatarColor: users.avatarColor,
                    avatarUrl: users.avatarUrl,
                })
                .from(users)
                .where(inArray(users.id, Array.from(userIds)))
            : [];

    const categoryById = new Map(
        categories.map((c) => [
            c.id,
            { label: c.label, sub: c.sub, icon: c.icon },
        ]),
    );
    const departmentById = new Map(
        departments.map((d) => [d.id, { name: d.name }]),
    );
    const userById = new Map(
        userRows.map((u) => [
            u.id,
            { name: u.name, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl },
        ]),
    );

    const rows = enrichRows(
        page.rows,
        categoryById,
        departmentById,
        userById,
    );

    const nextHref = page.nextCursor
        ? buildHref(params, { cursor: encodeCursor(page.nextCursor) })
        : null;

    return (
        <div>
            <PageHeader
                title="Tickets"
                description="Lista de chamados"
                actions={
                    <Button variant="primary" asChild icon={<Plus />}>
                        <Link href="/tickets/novo">Novo ticket</Link>
                    </Button>
                }
            />

            {/* Barra de filtros interativa (R11.2). */}
            <TicketsFilterBar
                categories={categories}
                departments={departments}
                canFilterByAssignee={user.role !== "solicitante"}
            />

            <TicketsDataTable rows={rows} policies={policies} />

            {nextHref ? (
                <div className="mt-4 flex justify-end">
                    <Button variant="default" asChild>
                        <Link href={nextHref}>Próxima página</Link>
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
