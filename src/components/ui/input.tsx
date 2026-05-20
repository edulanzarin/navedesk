/**
 * Primitivo `Input` — campo de texto de uma linha no estilo shadcn/ui.
 *
 * Extende todas as props nativas de `<input>` (incluindo `type`, `value`,
 * `onChange`, eventos, `aria-*`, `data-*`, `name`, `autoComplete`, etc.) e
 * adiciona apenas a flag `error` para aplicar o estado visual de erro
 * (borda + ring no token `--red`). Quando `error=true`, marca
 * automaticamente `aria-invalid="true"` — a menos que o consumidor já
 * tenha definido explicitamente `aria-invalid` (controle manual prevalece).
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

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    /** Quando `true`, aplica visual de erro e seta `aria-invalid="true"`. */
    error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
    { className, type, error = false, "aria-invalid": ariaInvalid, ...props },
    ref,
) {
    return (
        <input
            ref={ref}
            type={type ?? "text"}
            aria-invalid={ariaInvalid ?? (error ? true : undefined)}
            className={cn(
                // base — layout, dimensões e tipografia (Liquid Glass)
                "flex h-10 w-full rounded-(--r-3) border border-hairline border-(--line-glass) bg-white/55 backdrop-blur-md px-3 py-2 text-sm",
                // tinta + placeholder
                "text-(--ink) placeholder:text-(--ink-4)",
                // transição suave
                "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                // foco visível — borda + halo de acento (estilo macOS)
                "focus-visible:outline-none focus-visible:border-(--accent) focus-visible:bg-white/80 focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]",
                // disabled
                "disabled:opacity-50 disabled:cursor-not-allowed",
                // erro — borda + ring no token --red (sobrepõe o foco padrão)
                error &&
                    "border-(--red) focus-visible:border-(--red) focus-visible:shadow-[0_0_0_3px_var(--red-soft)]",
                className,
            )}
            {...props}
        />
    );
});

export { Input };
