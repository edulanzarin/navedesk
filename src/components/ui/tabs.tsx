/**
 * Primitivos `Tabs` baseados em `@radix-ui/react-tabs`.
 *
 * Conjunto acessível de abas controladas/uncontroladas com navegação por
 * teclado (setas, Home/End) e gerenciamento de foco fornecidos pelo
 * Radix. A estética segue o padrão "segmented control" da referência
 * visual: lista em fundo recuado (`--bg-sunk`) com gatilhos arredondados
 * que ganham superfície elevada (`--bg-elev`) e sombra `--sh-1` quando
 * ativos.
 *
 * Subcomponentes exportados:
 *
 * - `Tabs`         — raiz (re-exporta `RadixTabs.Root`).
 * - `TabsList`     — barra horizontal contendo os gatilhos.
 * - `TabsTrigger`  — botão de aba; usa `data-[state=active]` para o
 *                    estado selecionado, exposto pelo Radix.
 * - `TabsContent`  — painel associado a uma aba, oculto enquanto
 *                    inativo (Radix cuida do `hidden`).
 *
 * Todos os subcomponentes encaminham `ref` e aceitam `className`,
 * permitindo composição via `cn` sem perder os estilos base. Marcado
 * como Client Component porque o Radix Tabs depende de estado e
 * efeitos de foco no cliente.
 *
 * Validates: R19.3
 */

"use client";

import * as React from "react";

import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/cn";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.List>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
    return (
        <TabsPrimitive.List
            ref={ref}
            className={cn(
                "inline-flex items-center rounded-(--r-3) bg-black/[0.05] p-1 gap-0.5",
                className,
            )}
            {...props}
        />
    );
});

const TabsTrigger = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
    return (
        <TabsPrimitive.Trigger
            ref={ref}
            className={cn(
                // Layout base do gatilho.
                "inline-flex items-center justify-center whitespace-nowrap",
                "px-3 py-1 rounded-(--r-2) text-[12.5px] font-medium tracking-tight",
                // Estado inativo — texto secundário, transição suave.
                "text-(--ink-2) transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                // Foco visível com ring no token de acento.
                "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-sunk)",
                // Disabled.
                "disabled:pointer-events-none disabled:opacity-50",
                // Estado ativo (data-state="active" exposto pelo Radix).
                "data-[state=active]:bg-(--bg-elev) data-[state=active]:text-(--ink)",
                "data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                className,
            )}
            {...props}
        />
    );
});

const TabsContent = React.forwardRef<
    React.ElementRef<typeof TabsPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
    return (
        <TabsPrimitive.Content
            ref={ref}
            className={cn(
                "pt-4 outline-none",
                "focus-visible:ring-2 focus-visible:ring-(--accent)",
                "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)",
                className,
            )}
            {...props}
        />
    );
});

export { Tabs, TabsList, TabsTrigger, TabsContent };
