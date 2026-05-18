/**
 * Componente de domínio `CategoryChip`.
 *
 * Pequeno chip que representa a categoria de um ticket combinando um
 * ícone Lucide e um rótulo curto, com subtítulo opcional para
 * desambiguar variações (ex.: "Hardware · Periféricos").
 *
 * O `lucide-react` não permite resolução dinâmica de ícones por nome
 * de forma amigável a tree-shaking — importações nominais são o caminho
 * recomendado. Por isso mantemos um mapa explícito (allowlist) de nomes
 * aceitos para os ícones; nomes desconhecidos caem no ícone genérico
 * `Tag`, garantindo que a UI nunca quebre por causa de dados.
 *
 * Visual (alinhado à referência em `.example/styles.css`):
 *
 * - Pílula `inline-flex` com `gap-2`, raio `--r-pill` e fundo `--bg-sunk`
 * - Tipografia `text-sm`; rótulo em `--ink`, ícone em `--ink-3`
 * - Subtítulo opcional em `--ink-3`, separado por um middle-dot
 *
 * Validates: R19.4
 */

import * as React from "react";

import {
    Code,
    Cog,
    Info,
    Key,
    Mail,
    Monitor,
    Package,
    Tag,
    Wifi,
    type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Allowlist de ícones suportados pelo chip.
 *
 * Mantemos as importações nominais para preservar tree-shaking; novos
 * nomes só passam a ser aceitos se forem adicionados explicitamente
 * aqui, evitando supressão silenciosa por dados arbitrários do banco.
 */
const ICONS = {
    monitor: Monitor,
    package: Package,
    cog: Cog,
    wifi: Wifi,
    key: Key,
    mail: Mail,
    info: Info,
    code: Code,
} as const satisfies Record<string, LucideIcon>;

/** Nomes de ícones aceitos pela allowlist. */
export type CategoryChipIcon = keyof typeof ICONS;

export interface CategoryChipProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
    /** Nome do ícone Lucide. Nomes desconhecidos caem em `Tag`. */
    icon: string;
    /** Rótulo principal exibido em `--ink`. */
    label: string;
    /** Subtítulo opcional exibido em `--ink-3`, separado por `·`. */
    sub?: string;
}

/**
 * Resolve o componente de ícone para um nome conhecido, com fallback
 * em `Tag` para entradas inválidas ou ausentes.
 */
function resolveIcon(name: string): LucideIcon {
    return (ICONS as Record<string, LucideIcon>)[name] ?? Tag;
}

export const CategoryChip = React.forwardRef<HTMLSpanElement, CategoryChipProps>(
    function CategoryChip({ icon, label, sub, className, ...props }, ref) {
        const Icon = resolveIcon(icon);

        return (
            <span
                ref={ref}
                className={cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-(--r-pill) bg-(--bg-sunk) px-2.5 py-1 text-sm",
                    className,
                )}
                {...props}
            >
                <Icon aria-hidden="true" className="size-4 text-(--ink-3)" />
                <span className="text-(--ink)">{label}</span>
                {sub ? (
                    <span className="text-(--ink-3)">
                        <span aria-hidden="true"> · </span>
                        {sub}
                    </span>
                ) : null}
            </span>
        );
    },
);
