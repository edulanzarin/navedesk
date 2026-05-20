/**
 * Primitivo `Dialog` baseado em `@radix-ui/react-dialog`.
 *
 * Modal acessível com foco aprisionado, fechamento por `Esc`, overlay
 * que escurece o fundo e animações suaves de entrada/saída. Segue o
 * padrão shadcn/ui — re-exporta diretamente as primitivas Radix
 * (`Root`, `Trigger`, `Portal`, `Close`) e empacota `Overlay`/`Content`
 * com tokens do design system para que o consumidor não precise se
 * preocupar com posicionamento, sombra ou padding.
 *
 * Subcomponentes exportados:
 *
 * - `Dialog`            — raiz controlada por `open` / `onOpenChange`.
 * - `DialogTrigger`     — botão que abre o diálogo.
 * - `DialogPortal`      — portaliza para `<body>`; não costuma ser usado
 *                          diretamente fora deste módulo.
 * - `DialogOverlay`     — máscara escura com `backdrop-blur`.
 * - `DialogContent`     — caixa central animada com `--bg-elev`,
 *                          `--r-4`, `--sh-pop`, `p-6` e botão de fechar.
 * - `DialogHeader`      — agrupador de `Title` + `Description`.
 * - `DialogFooter`      — área de ações (alinhada à direita por padrão).
 * - `DialogTitle`       — título acessível (`<h2>`); obrigatório para a11y.
 * - `DialogDescription` — descrição auxiliar (`<p>`).
 * - `DialogClose`       — botão (ou wrapper `asChild`) que fecha o diálogo.
 *
 * Animações:
 *   Aproveitam os atributos `data-[state=open|closed]` que o Radix
 *   anexa automaticamente em `Overlay` e `Content`. As classes
 *   `animate-fade-*` / `animate-zoom-*` são definidas em `globals.css`.
 *
 * Validates: R19.3
 */

"use client";

import * as React from "react";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
    return (
        <DialogPrimitive.Overlay
            ref={ref}
            className={cn(
                "fixed inset-0 z-50 bg-black/30 backdrop-blur-md",
                "data-[state=open]:animate-fade-in",
                "data-[state=closed]:animate-fade-out",
                className,
            )}
            {...props}
        />
    );
});

const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Content
                ref={ref}
                className={cn(
                    // Posicionamento central via translate (combina com o
                    // keyframe `navedesk-zoom-*` que preserva o translate).
                    "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
                    // Caixa: largura, vidro, raio, sombra, padding.
                    "w-full max-w-lg rounded-(--r-5) p-6 shadow-(--sh-pop)",
                    "bg-white/94 glass-panel-intense",
                    "border border-hairline border-(--line-glass)",
                    // Animações Radix (data-state=open|closed).
                    "data-[state=open]:animate-zoom-in",
                    "data-[state=closed]:animate-zoom-out",
                    // Foco
                    "outline-none",
                    className,
                )}
                {...props}
            >
                {children}
                <DialogPrimitive.Close
                    className={cn(
                        "absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center",
                        "rounded-(--r-2) text-(--ink-3) hover:bg-black/[0.05] hover:text-(--ink)",
                        "transition-colors duration-[var(--dur-fast)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                        "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-elev)",
                        "disabled:pointer-events-none",
                    )}
                    aria-label="Fechar"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPortal>
    );
});

function DialogHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "flex flex-col gap-1.5 text-left mb-4 pr-8",
                className,
            )}
            {...props}
        />
    );
}

function DialogFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
                className,
            )}
            {...props}
        />
    );
}

const DialogTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
    return (
        <DialogPrimitive.Title
            ref={ref}
            className={cn(
                "text-lg font-semibold leading-tight tracking-tight text-(--ink)",
                className,
            )}
            {...props}
        />
    );
});

const DialogDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
    return (
        <DialogPrimitive.Description
            ref={ref}
            className={cn("text-sm text-(--ink-3)", className)}
            {...props}
        />
    );
});

export {
    Dialog,
    DialogTrigger,
    DialogPortal,
    DialogOverlay,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
    DialogClose,
};
