/**
 * Primitivos `Toast` no estilo shadcn/ui sobre `@radix-ui/react-toast`.
 *
 * Notificações temporárias para feedback de ações (ex.: "Ticket criado",
 * "Falha no upload"). Os primitivos exportados aqui são puramente
 * apresentacionais e seguem a estética definida em `tokens.css` — não
 * tomam decisão sobre quando aparecem, apenas como aparecem.
 *
 * Subcomponentes exportados:
 *
 * - `ToastProvider`    — wrapper Radix, controla duração, swipe e ordem.
 * - `ToastViewport`    — região fixa onde os toasts são empilhados.
 * - `Toast`            — raiz visual; aceita `variant` para mapear o tom.
 * - `ToastTitle`       — título do toast (negrito).
 * - `ToastDescription` — texto auxiliar com cor `--ink-3`.
 * - `ToastAction`      — botão de ação opcional (ex.: "Desfazer").
 * - `ToastClose`       — botão `X` para descartar manualmente.
 *
 * Tons aplicados por variante (paleta dos `tokens.css`):
 *
 * - `default` — borda neutra `--line`, sem cor de status.
 * - `info`    — borda `--blue`, ícone azul.
 * - `success` — borda `--green`, ícone verde.
 * - `warn`    — borda `--amber`, ícone âmbar.
 * - `error`   — borda `--red`, ícone vermelho.
 *
 * Disparo imperativo: ver `use-toast.ts`. O `Toaster` (também em
 * `use-toast.ts`) monta `ToastProvider` + `ToastViewport` e é incluído
 * uma única vez no `layout.tsx` raiz, satisfazendo R19.3 e R22.
 *
 * Validates: R19.3, R22
 */

"use client";

import * as React from "react";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * `ToastProvider` — alias direto do Radix.
 *
 * Mantido como reexport para que o consumidor importe tudo a partir de
 * `@/components/ui/toast`, sem precisar tocar `@radix-ui/react-toast`.
 */
const ToastProvider = ToastPrimitive.Provider;

/**
 * `ToastViewport` — região visível que ancora os toasts.
 *
 * Posicionado em `bottom-4 right-4` com `z-50` e largura máxima de
 * `max-w-sm` para garantir legibilidade em mobile e desktop. O Radix
 * empilha as notificações respeitando `flex-col gap-2`.
 */
const ToastViewport = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Viewport>,
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
    return (
        <ToastPrimitive.Viewport
            ref={ref}
            className={cn(
                "fixed bottom-4 right-4 z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 outline-none",
                className,
            )}
            {...props}
        />
    );
});

/**
 * Variantes visuais do `Toast`.
 *
 * A cor da borda esquerda destaca o tom de status sem competir com o
 * fundo elevado. Usamos `border-l-4` para dar peso visual; as demais
 * bordas seguem `--line` para coerência com `Card` e `Dialog`.
 */
const toastVariants = cva(
    [
        // base — empilhamento, raio, vidro, sombra
        "group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden",
        "rounded-(--r-3) border border-hairline border-(--line-glass)",
        "glass-panel p-3 pr-8 shadow-(--sh-pop)",
        // animações Radix (entrada/saída + swipe)
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full",
        "data-[swipe=cancel]:translate-x-0",
        "data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]",
        "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
        "data-[swipe=move]:transition-none",
        "transition-all",
    ].join(" "),
    {
        variants: {
            variant: {
                default: "border-l-[3px] border-l-(--ink-4)",
                info: "border-l-[3px] border-l-(--blue)",
                success: "border-l-[3px] border-l-(--green)",
                warn: "border-l-[3px] border-l-(--amber)",
                error: "border-l-[3px] border-l-(--red)",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

export type ToastVariant = NonNullable<
    VariantProps<typeof toastVariants>["variant"]
>;

export interface ToastProps
    extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
    VariantProps<typeof toastVariants> { }

/**
 * `Toast` — raiz visual do toast.
 *
 * Recebe `variant` para aplicar o tom; demais props (duration, onOpenChange,
 * forceMount, etc.) são repassadas ao `ToastPrimitive.Root` do Radix.
 */
const Toast = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Root>,
    ToastProps
>(function Toast({ className, variant, ...props }, ref) {
    return (
        <ToastPrimitive.Root
            ref={ref}
            className={cn(toastVariants({ variant }), className)}
            {...props}
        />
    );
});

/**
 * `ToastTitle` — linha principal do toast.
 *
 * Tipografia firme (`font-semibold`) para destacar a mensagem-chave.
 */
const ToastTitle = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(function ToastTitle({ className, ...props }, ref) {
    return (
        <ToastPrimitive.Title
            ref={ref}
            className={cn(
                "text-sm font-semibold leading-tight text-(--ink)",
                className,
            )}
            {...props}
        />
    );
});

/**
 * `ToastDescription` — texto auxiliar (motivo, próximo passo).
 *
 * Cor `--ink-3` para hierarquia, mantendo o título em primeiro plano.
 */
const ToastDescription = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(function ToastDescription({ className, ...props }, ref) {
    return (
        <ToastPrimitive.Description
            ref={ref}
            className={cn("mt-1 text-sm text-(--ink-3)", className)}
            {...props}
        />
    );
});

/**
 * `ToastAction` — botão opcional para ação contextual (ex.: "Desfazer").
 *
 * Estilizado como botão `ghost` para não competir com o `ToastClose`.
 */
const ToastAction = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Action>,
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(function ToastAction({ className, ...props }, ref) {
    return (
        <ToastPrimitive.Action
            ref={ref}
            className={cn(
                "inline-flex h-8 shrink-0 items-center justify-center rounded-(--r-2) border border-(--line) bg-transparent px-3 text-sm font-medium text-(--ink) transition-colors",
                "hover:bg-(--accent-soft-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                "disabled:pointer-events-none disabled:opacity-50",
                className,
            )}
            {...props}
        />
    );
});

/**
 * `ToastClose` — botão `X` para descartar manualmente.
 *
 * Posicionado no canto superior direito sem ocupar fluxo, com área de
 * clique adequada (h-6 w-6) e foco visível.
 */
const ToastClose = React.forwardRef<
    React.ElementRef<typeof ToastPrimitive.Close>,
    React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(function ToastClose({ className, ...props }, ref) {
    return (
        <ToastPrimitive.Close
            ref={ref}
            toast-close=""
            aria-label="Fechar notificação"
            className={cn(
                "absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-(--r-2) text-(--ink-3) opacity-70 transition-opacity",
                "hover:bg-(--bg-sunk) hover:text-(--ink) hover:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                className,
            )}
            {...props}
        >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
        </ToastPrimitive.Close>
    );
});

export {
    ToastProvider,
    ToastViewport,
    Toast,
    ToastTitle,
    ToastDescription,
    ToastAction,
    ToastClose,
    toastVariants,
};
