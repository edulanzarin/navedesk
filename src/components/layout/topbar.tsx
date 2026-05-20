/**
 * `Topbar` — barra superior do layout autenticado.
 *
 * Exibe o título e o subtítulo da página corrente, um slot opcional
 * para ações (botões de página, filtros, etc.) e o avatar do usuário
 * com um menu suspenso contendo:
 *
 * - link para `/perfil`;
 * - item "Sair" que dispara a Server Action de logout (a ser entregue
 *   por `actions/auth.ts` na tarefa 13.6). Enquanto a action dedicada
 *   não existe, o consumidor passa um handler via prop `signOutAction`
 *   que invoca `signOut({ redirectTo: "/login" })` exportado por
 *   `lib/auth.ts`.
 *
 * Como o Radix Dropdown depende de hooks e portais, o componente roda
 * como Client Component (`"use client"`).
 *
 * Validates: R1.8.
 */

"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar } from "@/components/ui/avatar";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownLabel,
    DropdownSeparator,
    DropdownTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";
import type { SessionUser } from "@/types/domain";

/**
 * Mapa de rotas para títulos exibidos na topbar.
 *
 * A chave é o **prefixo** da rota (sem trailing slash, exceto a raiz
 * `/dashboard`). A lookup é feita por `startsWith`, então rotas mais
 * específicas precisam aparecer ANTES das mais genéricas — por
 * exemplo, `/tickets/atribuidos` deve preceder `/tickets` na ordem
 * de iteração.
 *
 * Adicionar uma nova área da aplicação? Inclua a entrada aqui e
 * ela aparece automaticamente.
 */
const ROUTE_TITLES: ReadonlyArray<readonly [string, string]> = [
    ["/dashboard", "Dashboard"],
    ["/tickets/novo", "Novo ticket"],
    ["/tickets/atribuidos", "Atribuídos a mim"],
    ["/tickets", "Tickets"],
    ["/kb/novo", "Novo artigo"],
    ["/kb", "Base de conhecimento"],
    ["/admin/usuarios", "Usuários"],
    ["/admin/categorias", "Categorias"],
    ["/admin/departamentos", "Departamentos"],
    ["/admin/sla", "Políticas de SLA"],
    ["/admin/templates", "Modelos de ticket"],
    ["/admin/geral", "Configurações"],
    ["/relatorios", "Relatórios"],
    ["/notificacoes", "Notificações"],
    ["/perfil", "Perfil"],
] as const;

/**
 * Resolve o título da página corrente a partir do `pathname`. Faz
 * busca por prefixo na ordem de declaração — ver comentário em
 * `ROUTE_TITLES` para a regra de precedência.
 *
 * O fallback (`fallback`) é usado em rotas não mapeadas — em geral
 * o nome da marca, para preservar o branding.
 */
function resolveRouteTitle(
    pathname: string | null,
    fallback: string,
): string {
    if (!pathname) return fallback;
    for (const [prefix, title] of ROUTE_TITLES) {
        if (pathname === prefix || pathname.startsWith(prefix + "/")) {
            return title;
        }
    }
    return fallback;
}

export interface TopbarProps {
    /**
     * Título da página corrente. Quando omitido, é derivado do
     * `pathname` via `resolveRouteTitle`. Páginas que precisem de um
     * título dinâmico (ex.: detalhe de ticket com o ID) podem passar
     * o valor explicitamente.
     */
    title?: string;
    /** Subtítulo opcional, exibido em texto menor logo abaixo. */
    subtitle?: string;
    /** Slot livre para ações específicas da página (botões, filtros). */
    actions?: React.ReactNode;
    /** Usuário autenticado; alimenta avatar + menu de perfil/logout. */
    user: SessionUser;
    /**
     * Server Action chamada quando o usuário aciona "Sair". Recebida via
     * prop para evitar acoplamento direto com `lib/auth.ts` no client
     * bundle e para permitir testes injetando uma ação fake.
     */
    signOutAction: () => Promise<void>;
    /**
     * Fallback usado quando nem `title` nem o mapa de rotas
     * resolverem o nome da página. Default: nome da marca, vindo do
     * pai (`BRAND_NAME`).
     */
    fallbackTitle?: string;
    /** Classes adicionais aplicadas ao wrapper. */
    className?: string;
}

/**
 * Item de menu que dispara a Server Action de logout.
 *
 * Usa `onSelect` do Radix em vez de `<form action={...}>` para integrar
 * naturalmente com o `DropdownItem` (close-on-select, navegação por
 * teclado). O `event.preventDefault()` evita que o Radix feche o menu
 * antes da Server Action concluir; o redirecionamento subsequente em
 * `signOutAction` desmonta a árvore e cancela qualquer animação.
 */
function SignOutMenuItem({
    action,
}: {
    action: () => Promise<void>;
}): React.JSX.Element {
    return (
        <DropdownItem
            onSelect={(event) => {
                event.preventDefault();
                void action();
            }}
            className="text-(--red) hover:bg-(--red-soft) focus:bg-(--red-soft)"
        >
            Sair
        </DropdownItem>
    );
}

export function Topbar({
    title,
    subtitle,
    actions,
    user,
    signOutAction,
    fallbackTitle = "Navedesk",
    className,
}: TopbarProps): React.JSX.Element {
    const pathname = usePathname();
    // Título explícito tem precedência; em rotas conhecidas, o mapa
    // resolve. Fora disso, cai no fallback (nome da marca).
    const resolvedTitle = title ?? resolveRouteTitle(pathname, fallbackTitle);

    return (
        <header
            className={cn(
                "sticky top-0 z-10 flex h-16 items-center justify-between border-b border-hairline border-(--line) glass-panel px-6",
                "bg-(--bg-topbar)",
                className,
            )}
        >
            <div className="min-w-0">
                <h1 className="truncate text-[17px] font-semibold tracking-tight text-(--ink)">
                    {resolvedTitle}
                </h1>
                {subtitle ? (
                    <p className="truncate text-xs text-(--ink-3)">
                        {subtitle}
                    </p>
                ) : null}
            </div>

            <div className="flex items-center gap-3">
                {actions ? (
                    <div className="flex items-center gap-2">{actions}</div>
                ) : null}

                <Dropdown>
                    <DropdownTrigger asChild>
                        <button
                            type="button"
                            aria-label={`Menu da conta de ${user.name}`}
                            className="rounded-full outline-none transition-transform duration-[var(--dur-fast)] hover:scale-105 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2"
                        >
                            <Avatar
                                name={user.name}
                                size="md"
                                {...(user.avatarColor
                                    ? { color: user.avatarColor }
                                    : {})}
                                {...(user.avatarUrl
                                    ? { src: user.avatarUrl }
                                    : {})}
                            />
                        </button>
                    </DropdownTrigger>
                    <DropdownContent align="end">
                        <DropdownLabel className="normal-case tracking-normal">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-(--ink)">
                                    {user.name}
                                </span>
                                <span className="text-xs text-(--ink-3)">
                                    {user.email}
                                </span>
                            </div>
                        </DropdownLabel>
                        <DropdownSeparator />
                        <DropdownItem asChild>
                            <Link href="/perfil">Perfil</Link>
                        </DropdownItem>
                        <DropdownSeparator />
                        <SignOutMenuItem action={signOutAction} />
                    </DropdownContent>
                </Dropdown>
            </div>
        </header>
    );
}
