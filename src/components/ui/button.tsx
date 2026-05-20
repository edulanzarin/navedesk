/**
 * Button — primitivo de UI no estilo shadcn/ui com `class-variance-authority`.
 *
 * Variantes:
 *   - primary | default | ghost | danger
 *
 * Tamanhos:
 *   - sm | md | lg | icon
 *
 * Recursos extras:
 *   - `asChild`  — delega o render para um filho via `@radix-ui/react-slot`,
 *                  preservando classes e props (útil para envolver `<Link>`).
 *   - `loading`  — exibe `Loader2` girando, antecede a label e marca o botão
 *                  como `disabled` + `aria-busy`.
 *   - `icon`     — ícone à esquerda da label (ex.: `<Plus />`).
 *
 * Tokens consumidos via classes Tailwind v4 com `bg-(--accent)` etc.; o
 * Tailwind v4 trata custom properties como cores arbitrárias. Raio padrão
 * usa `--r-3`. Foco visível com ring no token `--accent`.
 *
 * Validates: R19.3, R19.8
 */

"use client";

import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
    [
        // base
        "inline-flex items-center justify-center gap-2 whitespace-nowrap",
        "rounded-(--r-3) font-medium tracking-tight select-none",
        "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        // press effect
        "active:scale-[0.98]",
        // foco (token --accent)
        "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)",
        // disabled
        "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
        // ícone tamanho padrão
        "[&_svg]:shrink-0 [&_svg]:size-4",
    ].join(" "),
    {
        variants: {
            variant: {
                primary: [
                    "bg-(--accent) text-white",
                    "shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_3px_var(--accent-glow)]",
                    "hover:bg-(--accent-3) hover:shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_2px_8px_var(--accent-glow),0_4px_18px_rgba(94,92,230,0.25)]",
                ].join(" "),
                default: [
                    "bg-(--bg-elev) text-(--ink)",
                    "border border-hairline border-(--line)",
                    "shadow-(--sh-1)",
                    "hover:bg-(--bg-sunk)",
                ].join(" "),
                ghost: "bg-transparent text-(--ink) hover:bg-black/[0.05]",
                danger: [
                    "bg-(--red) text-white",
                    "shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_1px_3px_rgba(224,52,43,0.35)]",
                    "hover:opacity-90",
                ].join(" "),
            },
            size: {
                sm: "h-8 px-3 text-sm",
                md: "h-10 px-4 text-sm",
                lg: "h-11 px-5 text-base",
                icon: "h-10 w-10 p-0",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "md",
        },
    },
);

export type ButtonVariant = NonNullable<
    VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonSize = NonNullable<
    VariantProps<typeof buttonVariants>["size"]
>;

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    /** Renderiza no elemento filho (via Radix Slot) preservando classes/props. */
    asChild?: boolean;
    /** Mostra spinner e desabilita o botão. */
    loading?: boolean;
    /** Ícone exibido à esquerda da label. */
    icon?: React.ReactNode;
}

/**
 * Conteúdo "interno" do botão — spinner ou ícone à esquerda + label.
 * Extraído para ser reutilizado tanto no caminho `<button>` quanto no
 * caminho `asChild` (onde clonamos o filho injetando este conteúdo).
 */
function renderContent({
    loading,
    icon,
    children,
}: Pick<ButtonProps, "loading" | "icon" | "children">): React.ReactNode {
    return (
        <>
            {loading ? (
                <Loader2
                    className="animate-spin"
                    aria-hidden="true"
                    data-testid="button-spinner"
                />
            ) : icon ? (
                <span aria-hidden="true" className="inline-flex">
                    {icon}
                </span>
            ) : null}
            {children}
        </>
    );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        {
            className,
            variant,
            size,
            asChild = false,
            loading = false,
            icon,
            disabled,
            type,
            children,
            ...props
        },
        ref,
    ) {
        const isDisabled = disabled || loading;
        const mergedClassName = cn(buttonVariants({ variant, size }), className);

        if (asChild) {
            // `Slot` exige exatamente um React element como filho. Clonamos o
            // elemento e injetamos o conteúdo (spinner/ícone + label) em seu
            // próprio `children`, preservando o restante do markup do consumidor
            // (ex.: `<Link href="...">Texto</Link>`).
            const child = React.Children.only(
                children,
            ) as React.ReactElement<{ children?: React.ReactNode }>;
            const childContent = renderContent({
                loading,
                icon,
                children: child.props.children,
            });
            const cloned = React.cloneElement(child, {
                children: childContent,
            });

            return (
                <Slot
                    ref={ref as React.Ref<HTMLElement>}
                    className={mergedClassName}
                    aria-busy={loading || undefined}
                    aria-disabled={isDisabled || undefined}
                    data-loading={loading || undefined}
                    data-disabled={isDisabled || undefined}
                    {...props}
                >
                    {cloned}
                </Slot>
            );
        }

        return (
            <button
                ref={ref}
                className={mergedClassName}
                type={type ?? "button"}
                disabled={isDisabled}
                aria-busy={loading || undefined}
                data-loading={loading || undefined}
                {...props}
            >
                {renderContent({ loading, icon, children })}
            </button>
        );
    },
);

export { Button, buttonVariants };
