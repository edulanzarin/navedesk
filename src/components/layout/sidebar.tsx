/**
 * Componente de layout `Sidebar`.
 *
 * Trilha lateral fixa do app autenticado. Responsabilidades:
 *
 * - Renderizar a navegação contextual ao papel do usuário (`solicitante`,
 *   `tecnico`, `admin`), conforme R2.7.
 * - Exibir contadores (`open`, `assigned`, `unassigned`) ao lado dos itens
 *   relevantes, conforme R10 (KPIs do dashboard) e R11 (atalhos de listagem).
 * - Destacar o item ativo segundo a rota corrente, lida com `usePathname()`,
 *   atendendo R11 (navegação consistente entre listas).
 *
 * O componente é puro de apresentação — recebe `user` e `counts` por prop,
 * sem fetch nem leitura de banco. A intenção é que o Server Component pai
 * (`app/(app)/layout.tsx`, task 14.4) busque a sessão, pré-calcule os
 * contadores via `services/stats.service` e os repasse aqui.
 *
 * O design original (`design.md`) declara o contrato:
 *
 * ```ts
 * interface SidebarProps {
 *   user: SessionUser;
 *   counts: { open: number; assigned: number; unassigned: number };
 *   active: string;
 * }
 * ```
 *
 * `active` permanece como override opcional para cenários de teste; quando
 * ausente, o destaque é derivado de `usePathname()` — o que mantém o item
 * ativo coerente em navegações client-side via `next/link`.
 *
 * Validates: R2.7, R10, R11
 */

"use client";

import * as React from "react";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
    AlertCircle,
    Bell,
    BarChart3,
    Building2,
    Cog,
    FileText,
    Inbox,
    LayoutDashboard,
    Library,
    Settings,
    Tag,
    User,
    UserCheck,
    Users,
    type LucideIcon,
} from "lucide-react";

import { BRAND_NAME, BRAND_ORG, LOGO_PATH } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import type { Role, SessionUser } from "@/types/domain";

/** Contadores numéricos exibidos como badges nos itens da trilha. */
export interface SidebarCounts {
    /** Tickets abertos visíveis ao usuário (escopo respeita papel). */
    open: number;
    /** Tickets cujo `assigneeId` é o usuário corrente. */
    assigned: number;
    /** Tickets sem responsável (relevante para `tecnico`/`admin`). */
    unassigned: number;
    /** Notificações não lidas do usuário corrente. */
    unread: number;
}

export interface SidebarProps {
    /** Usuário autenticado; dita visibilidade dos itens por papel. */
    user: SessionUser;
    /** Contadores pré-calculados pelo Server Component pai. */
    counts: SidebarCounts;
    /**
     * Rota ativa explícita (override). Quando omitido, o destaque é
     * calculado a partir de `usePathname()`.
     */
    active?: string;
}

/**
 * Descritor interno de um item da trilha.
 *
 * `match` contém uma lista de prefixos de pathname que ativam o item.
 * Quando `exact=true`, o pathname precisa coincidir integralmente com
 * a primeira entrada de `match` (uso típico para o item raiz do grupo,
 * evitando que `/tickets/atribuidos` ative também `/tickets`).
 */
interface SidebarItem {
    label: string;
    href: string;
    icon: LucideIcon;
    /** Papéis que enxergam o item; `undefined` = todos. */
    roles?: ReadonlyArray<Role>;
    /** Chave do contador a renderizar como badge, se houver. */
    countKey?: keyof SidebarCounts;
    /** Pathnames que devem ativar o item. */
    match: ReadonlyArray<string>;
    /** Quando `true`, exige igualdade exata com `match[0]`. */
    exact?: boolean;
}

/**
 * Cabeçalho de seção (rótulo separador entre grupos de itens).
 */
interface SidebarSection {
    kind: "section";
    label: string;
    roles?: ReadonlyArray<Role>;
}

type SidebarEntry = ({ kind: "item" } & SidebarItem) | SidebarSection;

/**
 * Itens da trilha em ordem de renderização.
 *
 * A ordem é estável e independe do papel — a filtragem acontece em tempo
 * de render através de `roles`. Isso facilita testes e mantém as posições
 * consistentes quando o usuário muda de papel.
 */
const ENTRIES: ReadonlyArray<SidebarEntry> = [
    {
        kind: "item",
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        match: ["/dashboard"],
    },
    {
        kind: "item",
        label: "Tickets",
        href: "/tickets",
        icon: Inbox,
        countKey: "open",
        match: ["/tickets"],
        exact: true,
    },
    {
        kind: "item",
        label: "Atribuídos a mim",
        href: "/tickets/atribuidos",
        icon: UserCheck,
        roles: ["tecnico", "admin"],
        countKey: "assigned",
        match: ["/tickets/atribuidos"],
    },
    {
        kind: "item",
        label: "Sem responsável",
        href: "/tickets?assignee=none",
        icon: AlertCircle,
        roles: ["tecnico", "admin"],
        countKey: "unassigned",
        match: ["/tickets/sem-responsavel"],
    },
    {
        kind: "item",
        label: "Base de conhecimento",
        href: "/kb",
        icon: Library,
        match: ["/kb"],
    },
    {
        kind: "item",
        label: "Notificações",
        href: "/notificacoes",
        icon: Bell,
        countKey: "unread",
        match: ["/notificacoes"],
    },

    { kind: "section", label: "Administração", roles: ["admin"] },
    {
        kind: "item",
        label: "Relatórios",
        href: "/relatorios",
        icon: BarChart3,
        roles: ["admin"],
        match: ["/relatorios"],
    },
    {
        kind: "item",
        label: "Usuários",
        href: "/admin/usuarios",
        icon: Users,
        roles: ["admin"],
        match: ["/admin/usuarios"],
    },
    {
        kind: "item",
        label: "SLA",
        href: "/admin/sla",
        icon: Cog,
        roles: ["admin"],
        match: ["/admin/sla"],
    },
    {
        kind: "item",
        label: "Categorias",
        href: "/admin/categorias",
        icon: Tag,
        roles: ["admin"],
        match: ["/admin/categorias"],
    },
    {
        kind: "item",
        label: "Modelos",
        href: "/admin/templates",
        icon: FileText,
        roles: ["admin"],
        match: ["/admin/templates"],
    },
    {
        kind: "item",
        label: "Departamentos",
        href: "/admin/departamentos",
        icon: Building2,
        roles: ["admin"],
        match: ["/admin/departamentos"],
    },
    {
        kind: "item",
        label: "Geral",
        href: "/admin/geral",
        icon: Settings,
        roles: ["admin"],
        match: ["/admin/geral"],
    },

    { kind: "section", label: "Conta" },
    {
        kind: "item",
        label: "Perfil",
        href: "/perfil",
        icon: User,
        match: ["/perfil"],
    },
];

/**
 * Decide se um item deve aparecer para o papel corrente.
 */
function isVisibleFor(role: Role, roles?: ReadonlyArray<Role>): boolean {
    return roles === undefined || roles.includes(role);
}

/**
 * Calcula se um item está ativo dado o pathname (ou override).
 *
 * Para itens marcados `exact`, exige correspondência completa com a
 * primeira entrada de `match`. Para os demais, qualquer prefixo da lista
 * `match` ativa o item — útil para destacar o pai quando o usuário está
 * em uma sub-rota (ex.: `/admin/sla/123`).
 */
function isActive(item: SidebarItem, pathname: string): boolean {
    if (item.exact) {
        return pathname === item.match[0];
    }
    return item.match.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

/**
 * Item visual da trilha. Componente local — não exportado.
 */
function SidebarLink({
    item,
    active,
    count,
}: {
    item: SidebarItem;
    active: boolean;
    count?: number;
}) {
    const Icon = item.icon;
    const showCount = typeof count === "number" && count > 0;

    return (
        <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
                // base — linha clicável com ícone à esquerda e badge à direita
                "group flex h-9 items-center gap-2.5 rounded-(--r-2) px-2.5 text-[13.5px] font-medium tracking-tight",
                "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                active
                    ? "bg-(--accent) text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_1px_3px_var(--accent-glow)]"
                    : "text-(--ink-2) hover:bg-black/[0.04] hover:text-(--ink)",
            )}
        >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {showCount ? (
                <span
                    aria-label={`${count} ${count === 1 ? "item" : "itens"}`}
                    className={cn(
                        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-(--r-pill) px-1.5 text-[11px] font-semibold tabular-nums",
                        active
                            ? "bg-white/22 text-white"
                            : "bg-black/[0.06] text-(--ink-3) group-hover:bg-black/[0.08]",
                    )}
                >
                    {count}
                </span>
            ) : null}
        </Link>
    );
}

/**
 * Trilha lateral de navegação.
 *
 * Renderiza, em ordem:
 * 1. Cabeçalho com a marca "NaveDesk".
 * 2. Itens contextuais ao papel (com contadores).
 * 3. Seção "Administração" (apenas `admin`).
 * 4. Seção "Conta" com link para `/perfil`.
 *
 * O destaque ativo prefere `props.active`; quando ausente, é derivado de
 * `usePathname()`. A largura fixa (`w-60`), o fundo `--bg-rail` e a borda
 * direita seguem a estética definida em `tokens.css`.
 */
export function Sidebar({ user, counts, active }: SidebarProps) {
    const pathname = usePathname() ?? "/";
    const currentPath = active ?? pathname;

    return (
        <aside
            aria-label="Navegação principal"
            className="flex h-full w-60 flex-col border-r border-hairline border-(--line) bg-(--bg-rail) glass-panel"
        >
            {/* Cabeçalho da marca */}
            <div className="flex h-16 items-center gap-2.5 border-b border-hairline border-(--line-soft) px-4">
                <Image
                    src={LOGO_PATH}
                    alt=""
                    width={32}
                    height={32}
                    className="size-8 shrink-0 object-contain"
                    priority
                />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold tracking-tight text-(--ink)">
                        {BRAND_NAME}
                    </div>
                    <div className="truncate text-xs text-(--ink-3)">
                        {BRAND_ORG}
                    </div>
                </div>
            </div>

            {/* Itens */}
            <nav className="flex-1 overflow-y-auto px-2 py-3">
                <ul className="flex flex-col gap-0.5">
                    {ENTRIES.map((entry, idx) => {
                        if (!isVisibleFor(user.role, entry.roles)) {
                            return null;
                        }

                        if (entry.kind === "section") {
                            return (
                                <li
                                    key={`section-${idx}`}
                                    className="px-2.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-(--ink-4)"
                                >
                                    {entry.label}
                                </li>
                            );
                        }

                        const count =
                            entry.countKey !== undefined
                                ? counts[entry.countKey]
                                : undefined;

                        return (
                            <li key={entry.href}>
                                <SidebarLink
                                    item={entry}
                                    active={isActive(entry, currentPath)}
                                    count={count}
                                />
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Rodapé com identidade do usuário */}
            <div className="border-t border-hairline border-(--line-soft) px-3 py-3">
                <div className="flex items-center gap-2.5 rounded-(--r-2) p-1.5 transition-colors hover:bg-black/[0.04]">
                    <Avatar
                        name={user.name}
                        size="md"
                        {...(user.avatarColor
                            ? { color: user.avatarColor }
                            : {})}
                        {...(user.avatarUrl ? { src: user.avatarUrl } : {})}
                    />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-(--ink)">
                            {user.name}
                        </div>
                        <div className="truncate text-xs text-(--ink-3)">
                            {roleLabel(user.role)}
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
}

/**
 * Rótulo pt-BR do papel para exibição no rodapé da trilha.
 *
 * Mantido local porque é específico da apresentação da `Sidebar`; rótulos
 * mais genéricos (status, prioridade) moram em `lib/constants.ts`.
 */
function roleLabel(role: Role): string {
    switch (role) {
        case "admin":
            return "Administrador";
        case "tecnico":
            return "Técnico TI";
        case "solicitante":
            return "Solicitante";
    }
}
