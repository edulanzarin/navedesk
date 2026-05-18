/**
 * Componente de layout `PageHeader`.
 *
 * Cabeçalho padrão de páginas autenticadas: título da página, descrição
 * opcional e área de ações alinhada à direita. Espelha o esboço de
 * interface declarado em `design.md` (seção *Components and Interfaces →
 * components/layout/page-header.tsx*) e fornece a composição visual
 * requerida por R19.4 (consistência tipográfica e espaçamento entre
 * páginas autenticadas).
 *
 * Layout:
 *
 * - Container `<header>` em flex com `items-start` para que `actions`
 *   permaneçam alinhadas ao topo do título mesmo quando a descrição
 *   ocupar múltiplas linhas.
 * - Bloco esquerdo (`min-w-0`) abriga `title` (`h1`) e `description`
 *   (`p`); `min-w-0` permite que textos longos sejam truncados sem
 *   empurrar a coluna direita.
 * - Bloco direito (`shrink-0`) abriga `actions` quando fornecidas.
 *
 * Componente puro e amigável a Server Components: não usa hooks nem
 * APIs de browser, apenas composição estática.
 *
 * Validates: R19.4
 */

import * as React from "react";

import { cn } from "@/lib/cn";

export interface PageHeaderProps {
    /** Título principal da página. Renderizado como `h1`. */
    title: string;
    /** Descrição curta opcional, exibida abaixo do título. */
    description?: string;
    /**
     * Área de ações alinhada à direita (botões, dropdowns, etc.).
     * Quando ausente, o cabeçalho colapsa para apenas título e descrição.
     */
    actions?: React.ReactNode;
    /** Classes adicionais para customização pontual do contêiner. */
    className?: string;
}

export function PageHeader({
    title,
    description,
    actions,
    className,
}: PageHeaderProps) {
    return (
        <header
            className={cn(
                "mb-6 flex items-start justify-between gap-4",
                className,
            )}
        >
            <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">
                    {title}
                </h1>
                {description ? (
                    <p className="mt-1 text-sm text-(--ink-3)">{description}</p>
                ) : null}
            </div>
            {actions ? (
                <div className="flex shrink-0 items-center gap-2">
                    {actions}
                </div>
            ) : null}
        </header>
    );
}
