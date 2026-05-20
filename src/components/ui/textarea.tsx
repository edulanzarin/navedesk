/**
 * Primitivo `Textarea` — campo de texto multi-linha no estilo shadcn/ui.
 *
 * Espelha o `Input` em estados visuais e a11y, ajustando dimensões para
 * texto longo: altura mínima de `min-h-24` e `resize-y` (apenas vertical),
 * coerente com o `.textarea` da referência visual.
 *
 * Extende todas as props nativas de `<textarea>` (incluindo `rows`,
 * `value`, `onChange`, `placeholder`, `aria-*`, `data-*`) e adiciona
 * apenas a flag `error`. Quando `error=true`, marca automaticamente
 * `aria-invalid="true"` — a menos que o consumidor já tenha definido
 * `aria-invalid` explicitamente.
 *
 * Estados visuais:
 *   - default  — borda `--line`, ring de foco `--accent`
 *   - error    — borda `--red`, ring de foco `--red`
 *   - disabled — opacidade reduzida + `cursor-not-allowed`
 *   - readOnly — apenas leitura, mantém aparência habilitada
 *
 * Acessibilidade:
 *   - Suporte a `aria-invalid` (auto via `error` ou manual).
 *   - Suporte a `aria-describedby` para vincular hint/erro externos.
 *
 * Validates: R19.3
 */

import * as React from "react";

import { cn } from "@/lib/cn";

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** Quando `true`, aplica visual de erro e seta `aria-invalid="true"`. */
    error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    function Textarea(
        { className, error = false, "aria-invalid": ariaInvalid, ...props },
        ref,
    ) {
        return (
            <textarea
                ref={ref}
                aria-invalid={ariaInvalid ?? (error ? true : undefined)}
                className={cn(
                    // base — layout, dimensões e tipografia
                    "flex min-h-24 w-full resize-y rounded-(--r-3) border border-hairline border-(--line-strong) bg-(--bg-elev) px-3 py-2 text-sm",
                    // tinta + placeholder
                    "text-(--ink) placeholder:text-(--ink-4)",
                    // transição suave
                    "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    // foco visível — borda + halo de acento
                    "focus-visible:outline-none focus-visible:border-(--accent) focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]",
                    // disabled
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    // erro
                    error &&
                        "border-(--red) focus-visible:border-(--red) focus-visible:shadow-[0_0_0_3px_var(--red-soft)]",
                    className,
                )}
                {...props}
            />
        );
    },
);

export { Textarea };
