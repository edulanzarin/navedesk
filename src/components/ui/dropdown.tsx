/**
 * Primitivos `Dropdown` baseados em `@radix-ui/react-dropdown-menu`.
 *
 * Wrapper fino sobre as primitivas do Radix que aplica o visual do
 * NaveDesk usando os tokens CSS definidos em `src/styles/tokens.css`. O
 * comportamento (acessibilidade, navegação por teclado, focus trap,
 * portal, posicionamento) é integralmente delegado ao Radix.
 *
 * Subcomponentes exportados:
 *
 * - `Dropdown`           — alias para o `Root` do Radix.
 * - `DropdownTrigger`    — alias para `Trigger`.
 * - `DropdownContent`    — painel flutuante (renderizado em `Portal`)
 *                           com fundo `--bg-elev`, borda `--line`,
 *                           radius `--r-3` e sombra `--sh-pop`.
 * - `DropdownItem`       — item clicável com hover/focus em
 *                           `--accent-soft-2`.
 * - `DropdownSeparator`  — linha divisória de 1px em `--line`.
 * - `DropdownLabel`      — rótulo de seção em caps, `--ink-3`.
 * - `DropdownGroup`      — agrupador semântico de itens.
 *
 * Todos os subcomponentes encaminham `ref` e aceitam `className`,
 * permitindo composição via `cn` sem perder os estilos base.
 *
 * Validates: R19.3
 */

"use client";

import * as React from "react";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/cn";

const Dropdown = DropdownMenu.Root;
const DropdownTrigger = DropdownMenu.Trigger;
const DropdownGroup = DropdownMenu.Group;

const DropdownContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenu.Content>,
    React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(function DropdownContent(
    { className, sideOffset = 6, ...props },
    ref,
) {
    return (
        <DropdownMenu.Portal>
            <DropdownMenu.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    "z-50 min-w-44 overflow-hidden p-1",
                    "rounded-(--r-3) border border-(--line) bg-(--bg-elev)",
                    "shadow-(--sh-pop) text-(--ink)",
                    className,
                )}
                {...props}
            />
        </DropdownMenu.Portal>
    );
});

const DropdownItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenu.Item>,
    React.ComponentPropsWithoutRef<typeof DropdownMenu.Item>
>(function DropdownItem({ className, ...props }, ref) {
    return (
        <DropdownMenu.Item
            ref={ref}
            className={cn(
                "flex items-center gap-2 px-2 py-1.5 text-sm",
                "rounded-(--r-2) cursor-pointer outline-none select-none",
                "hover:bg-(--accent-soft-2) focus:bg-(--accent-soft-2)",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                className,
            )}
            {...props}
        />
    );
});

const DropdownSeparator = React.forwardRef<
    React.ElementRef<typeof DropdownMenu.Separator>,
    React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(function DropdownSeparator({ className, ...props }, ref) {
    return (
        <DropdownMenu.Separator
            ref={ref}
            className={cn("h-px my-1 bg-(--line)", className)}
            {...props}
        />
    );
});

const DropdownLabel = React.forwardRef<
    React.ElementRef<typeof DropdownMenu.Label>,
    React.ComponentPropsWithoutRef<typeof DropdownMenu.Label>
>(function DropdownLabel({ className, ...props }, ref) {
    return (
        <DropdownMenu.Label
            ref={ref}
            className={cn(
                "px-2 py-1.5 text-xs uppercase tracking-wide text-(--ink-3)",
                className,
            )}
            {...props}
        />
    );
});

export {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownLabel,
    DropdownGroup,
};
