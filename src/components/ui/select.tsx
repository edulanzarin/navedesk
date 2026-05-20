/**
 * Primitivo `Select` — combobox acessível baseado em `@radix-ui/react-select`,
 * no estilo shadcn/ui, com tokens do NaveDesk (índigo Tahoe).
 *
 * Estrutura típica:
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
 *     <SelectContent>
 *       <SelectGroup>
 *         <SelectLabel>Status</SelectLabel>
 *         <SelectItem value="aberto">Aberto</SelectItem>
 *         <SelectItem value="andamento">Em andamento</SelectItem>
 *       </SelectGroup>
 *       <SelectSeparator />
 *       <SelectItem value="fechado">Fechado</SelectItem>
 *     </SelectContent>
 *   </Select>
 *
 * Estilo:
 *   - Trigger com altura `h-10`, borda `--line`, fundo `--bg-elev` e raio
 *     `--r-3`, espelhando `Input`/`Textarea` para coerência visual.
 *   - Conteúdo flutuante com sombra `--sh-pop`, raio `--r-3` e largura
 *     mínima igual à do trigger (variável CSS exposta pelo Radix
 *     `--radix-select-trigger-width`).
 *   - Item ativo (hover/focus) usa `--accent-soft-2`; selecionado usa
 *     `--accent-soft` + texto `--accent`. Indicador de seleção via
 *     `Check` no canto direito.
 *
 * Acessibilidade:
 *   - Radix entrega navegação por teclado, leitura por screen reader,
 *     `aria-*` e portal para evitar problemas de z-index/overflow.
 *   - Foco visível segue o ring `--accent`, igual aos demais primitivos.
 *
 * Validates: R19.3
 */

"use client";

import * as React from "react";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/cn";

/* ── Root / Group / Value ─────────────────────────────────── */

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

/* ── Trigger ──────────────────────────────────────────────── */

const SelectTrigger = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
    return (
        <SelectPrimitive.Trigger
            ref={ref}
            className={cn(
                // base — glass leve, espelha Input.
                "flex h-10 w-full items-center justify-between rounded-(--r-3) border border-hairline border-(--line) bg-white/45 backdrop-blur-md px-3 text-sm",
                // tinta + placeholder
                "text-(--ink) data-[placeholder]:text-(--ink-4)",
                // transição
                "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                // foco visível — borda + halo de acento
                "outline-none focus-visible:border-(--accent) focus-visible:bg-white/85 focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]",
                // disabled
                "disabled:cursor-not-allowed disabled:opacity-50",
                // ícone
                "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-(--ink-3)",
                "data-[state=open]:[&>svg]:rotate-180 [&>svg]:transition-transform [&>svg]:duration-[var(--dur-fast)]",
                className,
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDown aria-hidden="true" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
});

/* ── Scroll buttons (cima/baixo) ──────────────────────────── */

const SelectScrollUpButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
    return (
        <SelectPrimitive.ScrollUpButton
            ref={ref}
            className={cn(
                "flex cursor-default items-center justify-center py-1 text-(--ink-3)",
                className,
            )}
            {...props}
        >
            <ChevronUp className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollUpButton>
    );
});

const SelectScrollDownButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
    return (
        <SelectPrimitive.ScrollDownButton
            ref={ref}
            className={cn(
                "flex cursor-default items-center justify-center py-1 text-(--ink-3)",
                className,
            )}
            {...props}
        >
            <ChevronDown className="size-4" aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
    );
});

/* ── Content (popover) ────────────────────────────────────── */

const SelectContent = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent(
    { className, children, position = "popper", ...props },
    ref,
) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                ref={ref}
                position={position}
                className={cn(
                    // base — popover flutuante com vidro mais opaco
                    // (evita que conteúdo portalizado fora do dialog
                    // mostre o wallpaper colorido).
                    "relative z-50 max-h-96 min-w-[var(--radix-select-trigger-width)] overflow-hidden",
                    "rounded-(--r-3) border border-hairline border-(--line-glass)",
                    "bg-white/92 backdrop-blur-xl backdrop-saturate-150 p-1 text-(--ink) shadow-(--sh-pop)",
                    // animação leve (Radix expõe data-state)
                    "data-[state=open]:animate-slide-down",
                    "data-[state=closed]:animate-fade-out",
                    // posicionamento popper — desloca ligeiramente do trigger
                    position === "popper" &&
                    "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                    className,
                )}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        "p-1",
                        position === "popper" &&
                        "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
});

/* ── Label ────────────────────────────────────────────────── */

const SelectLabel = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
    return (
        <SelectPrimitive.Label
            ref={ref}
            className={cn(
                "px-2 py-1.5 text-xs font-medium text-(--ink-3)",
                className,
            )}
            {...props}
        />
    );
});

/* ── Item ─────────────────────────────────────────────────── */

const SelectItem = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
    return (
        <SelectPrimitive.Item
            ref={ref}
            className={cn(
                // base — item de lista
                "relative flex w-full cursor-pointer select-none items-center rounded-(--r-2) py-1.5 pl-2 pr-8 text-sm outline-none",
                // hover/focus
                "data-[highlighted]:bg-(--accent-soft-2) data-[highlighted]:text-(--ink)",
                // selecionado
                "data-[state=checked]:bg-(--accent-soft) data-[state=checked]:text-(--accent)",
                // disabled
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        >
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
            <span className="absolute right-2 flex size-4 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
            </span>
        </SelectPrimitive.Item>
    );
});

/* ── Separator ────────────────────────────────────────────── */

const SelectSeparator = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
    return (
        <SelectPrimitive.Separator
            ref={ref}
            className={cn("-mx-1 my-1 h-px bg-(--line)", className)}
            {...props}
        />
    );
});

export {
    Select,
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectLabel,
    SelectItem,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
};
