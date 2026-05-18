/**
 * Primitivos `Card` no estilo shadcn/ui.
 *
 * Container neutro usado para agrupar conteúdo em painéis com cabeçalho,
 * corpo e rodapé, espelhando o padrão `.card`/`.card-hd`/`.card-pad` da
 * referência visual em `.example/styles.css`.
 *
 * Subcomponentes exportados:
 *
 * - `Card`            — raiz, aplica fundo elevado, borda e radius `--r-4`.
 * - `CardHeader`      — topo com `gap` e padding generoso.
 * - `CardTitle`       — título (`<h3>`) com `font-semibold`.
 * - `CardDescription` — texto auxiliar (`<p>`) em `--ink-3`.
 * - `CardContent`     — corpo do card.
 * - `CardFooter`      — rodapé com borda superior em `--line`.
 *
 * Todos os subcomponentes encaminham `ref` e aceitam `className`,
 * permitindo composição via `cn` sem perder os estilos base.
 *
 * Validates: R19.3
 */

import * as React from "react";

import { cn } from "@/lib/cn";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    function Card({ className, ...props }, ref) {
        return (
            <div
                ref={ref}
                className={cn(
                    "rounded-(--r-4) bg-(--bg-elev) shadow-(--sh-1) border border-(--line)",
                    className,
                )}
                {...props}
            />
        );
    },
);

const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...props }, ref) {
    return (
        <div
            ref={ref}
            className={cn("flex flex-col gap-1.5 p-5 pb-3", className)}
            {...props}
        />
    );
});

const CardTitle = React.forwardRef<
    HTMLHeadingElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
    return (
        <h3
            ref={ref}
            className={cn("text-lg font-semibold leading-tight", className)}
            {...props}
        />
    );
});

const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
    return (
        <p
            ref={ref}
            className={cn("text-sm text-(--ink-3)", className)}
            {...props}
        />
    );
});

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...props }, ref) {
    return (
        <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
    );
});

const CardFooter = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...props }, ref) {
    return (
        <div
            ref={ref}
            className={cn(
                "flex items-center justify-between p-5 pt-3 border-t border-(--line)",
                className,
            )}
            {...props}
        />
    );
});

export {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
};
