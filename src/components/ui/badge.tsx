/**
 * Primitivo `Badge`.
 *
 * Pequena pílula informativa usada para representar status, prioridade,
 * papéis e demais rótulos categóricos. O mapeamento `domínio → tom` mora
 * sempre em componentes de domínio (ex.: `StatusBadge`, `PriorityPill`);
 * este primitivo apenas expõe os tons disponíveis via `cva`.
 *
 * Tons aceitos (ver `BadgeTone` em `src/lib/design-tokens.ts`):
 *
 * - `indigo` — destaque (acento da marca)
 * - `blue`   — informativo / status "aberto" / prioridade "media"
 * - `green`  — sucesso / status "resolvido"
 * - `amber`  — atenção / status "andamento" / prioridade "alta"
 * - `red`    — alerta / prioridade "critica"
 * - `grey`   — neutro / estados terminais ou inativos
 *
 * Cada tom usa um par de tokens CSS em `tokens.css` (`--*-soft` para o
 * fundo e `--*` para o texto), garantindo contraste adequado e mantendo
 * a paleta como única fonte de verdade.
 *
 * Por padrão renderiza um pequeno ponto à esquerda (`withDot=true`) que
 * herda a cor do texto via `bg-current`, espelhando o pseudo-elemento
 * `.badge::before` da referência visual em `.example/styles.css`.
 *
 * Validates: R19.3, R19.5, R19.6
 */

import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";
import type { BadgeTone } from "@/lib/design-tokens";

const badgeVariants = cva(
    // Layout base — pílula compacta com ícone opcional alinhado.
    "inline-flex items-center gap-1.5 rounded-(--r-pill) px-2.5 py-0.5 text-xs font-medium",
    {
        variants: {
            tone: {
                indigo: "bg-(--accent-soft) text-(--accent)",
                blue: "bg-(--blue-soft) text-(--blue)",
                green: "bg-(--green-soft) text-(--green)",
                amber: "bg-(--amber-soft) text-(--amber)",
                red: "bg-(--red-soft) text-(--red)",
                grey: "bg-(--grey-soft) text-(--ink-2)",
            } satisfies Record<BadgeTone, string>,
        },
        defaultVariants: {
            tone: "grey",
        },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
    /** Renderiza um ponto colorido antes do conteúdo. Default: `true`. */
    withDot?: boolean;
}

/**
 * Componente `Badge`.
 *
 * Aceita qualquer atributo padrão de `<span>` (incluindo `role`,
 * `aria-label`, etc.) para que componentes de domínio possam adicionar
 * semântica adicional sem precisar reembrulhar o elemento.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
    function Badge(
        { className, tone, withDot = true, children, ...props },
        ref,
    ) {
        return (
            <span
                ref={ref}
                className={cn(badgeVariants({ tone }), className)}
                {...props}
            >
                {withDot ? (
                    <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full bg-current"
                    />
                ) : null}
                {children}
            </span>
        );
    },
);

export { badgeVariants };
export type { BadgeTone };
