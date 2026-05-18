/**
 * Primitivo `Kbd`.
 *
 * Renderiza uma tecla de atalho de teclado no estilo "tecla física",
 * espelhando o bloco `.kbd` / `.search kbd` da referência visual em
 * `.example/styles.css`. Usa o token `--font-mono` (via `font-mono`)
 * aplicado globalmente a `<kbd>` em `src/app/globals.css`, com cantos
 * `--r-1`, borda `--line`, fundo `--bg-elev` e sombra `--sh-1` para
 * dar a sensação tátil de tecla elevada.
 *
 * Uso típico:
 *
 * - Indicar atalhos em campos de busca (ex.: `<Kbd>⌘K</Kbd>`).
 * - Documentar comandos em tooltips ou painéis de ajuda.
 *
 * Validates: R19.3
 */

import * as React from "react";

import { cn } from "@/lib/cn";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> { }

/**
 * Componente `Kbd`.
 *
 * Aceita qualquer atributo padrão de elemento HTML (incluindo
 * `aria-label`) e encaminha o `ref` para o `<kbd>` interno, permitindo
 * uso em medidores, tooltips controlados, etc.
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(function Kbd(
    { className, children, ...props },
    ref,
) {
    return (
        <kbd
            ref={ref}
            className={cn(
                "inline-flex items-center rounded-(--r-1) border border-(--line)",
                "bg-(--bg-elev) px-1.5 py-0.5 text-xs font-mono text-(--ink-2)",
                "shadow-(--sh-1)",
                className,
            )}
            {...props}
        >
            {children}
        </kbd>
    );
});
