/**
 * `use-toast` — fila imperativa de toasts e o componente `Toaster`.
 *
 * Inspirado no padrão `useToast` do shadcn/ui, oferece uma API
 * imperativa simples — `toast({ title, description, variant })` — que
 * pode ser chamada de qualquer Client Component (forms, handlers,
 * callbacks de Server Actions) sem precisar passar refs.
 *
 * Arquitetura:
 *
 * 1. Um pequeno store global (em módulo) mantém a lista de toasts
 *    abertos. `dispatch` é o único caminho de mutação.
 * 2. `useToast` se inscreve no store via `React.useSyncExternalStore`
 *    e devolve `{ toasts, toast, dismiss }` para o consumidor.
 * 3. `Toaster` (também aqui) é o único ponto que renderiza os toasts:
 *    monta `ToastProvider` + `ToastViewport` e mapeia `toasts` em
 *    instâncias visuais. Deve ficar uma única vez no `layout.tsx`.
 *
 * O store cobre apenas o que precisamos hoje: enfileirar, descartar e
 * limitar quantos toasts ficam visíveis simultaneamente. Não há
 * persistência — toasts somem ao recarregar.
 *
 * Validates: R19.3, R22
 */

"use client";

import * as React from "react";

import type { ToastVariant } from "@/components/ui/toast";

/**
 * Limite de toasts simultâneos na fila.
 *
 * Mantemos baixo (3) porque a UI vive em `bottom-4 right-4` e empilhar
 * muito interfere com conteúdo da página. Toasts excedentes derrubam o
 * mais antigo (FIFO).
 */
const TOAST_LIMIT = 3;

/**
 * Tempo padrão (ms) que um toast permanece visível.
 *
 * Pode ser sobrescrito por toast via `duration`.
 */
const TOAST_DEFAULT_DURATION_MS = 5000;

export interface ToastActionDescriptor {
    /** Texto do botão de ação (ex.: "Desfazer"). */
    label: string;
    /** Callback executado ao clicar. */
    onClick: () => void;
}

export interface ToastDescriptor {
    /** ID único do toast; gerado automaticamente se omitido. */
    id?: string;
    /** Linha principal — curta, ação concluída ou erro. */
    title: React.ReactNode;
    /** Detalhe opcional (motivo, próximo passo). */
    description?: React.ReactNode;
    /** Tom visual; default `default`. */
    variant?: ToastVariant;
    /** Duração customizada em ms; default `TOAST_DEFAULT_DURATION_MS`. */
    duration?: number;
    /** Ação contextual opcional (ex.: desfazer). */
    action?: ToastActionDescriptor;
}

interface ActiveToast extends Omit<ToastDescriptor, "id"> {
    id: string;
    open: boolean;
}

interface State {
    toasts: ActiveToast[];
}

type Action =
    | { type: "ADD"; toast: ActiveToast }
    | { type: "UPDATE_OPEN"; id: string; open: boolean }
    | { type: "DISMISS"; id?: string }
    | { type: "REMOVE"; id?: string };

/**
 * Reducer puro do store de toasts.
 *
 * Mantemos o reducer separado de `dispatch` para facilitar raciocínio:
 * todas as mutações passam por aqui, e o módulo é trivialmente
 * testável em unidade (basta importar `reducer`).
 */
function reducer(state: State, action: Action): State {
    switch (action.type) {
        case "ADD": {
            // FIFO: corta os mais antigos para respeitar TOAST_LIMIT.
            const next = [action.toast, ...state.toasts].slice(0, TOAST_LIMIT);
            return { toasts: next };
        }
        case "UPDATE_OPEN": {
            return {
                toasts: state.toasts.map((t) =>
                    t.id === action.id ? { ...t, open: action.open } : t,
                ),
            };
        }
        case "DISMISS": {
            // Apenas marca como fechado; a animação Radix dispara `onOpenChange`
            // que culmina em `REMOVE` via timeout.
            return {
                toasts: state.toasts.map((t) =>
                    action.id === undefined || t.id === action.id
                        ? { ...t, open: false }
                        : t,
                ),
            };
        }
        case "REMOVE": {
            if (action.id === undefined) return { toasts: [] };
            return {
                toasts: state.toasts.filter((t) => t.id !== action.id),
            };
        }
        default:
            return state;
    }
}

// ── store global em módulo ────────────────────────────────────────────
let memoryState: State = { toasts: [] };
const listeners = new Set<(state: State) => void>();

function dispatch(action: Action): void {
    memoryState = reducer(memoryState, action);
    for (const listener of listeners) listener(memoryState);
}

function subscribe(listener: (state: State) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): State {
    return memoryState;
}

// ID monotônico simples — não precisa ser global, basta ser único nesta
// instância de página (toasts não cruzam reloads).
let counter = 0;
function nextId(): string {
    counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
    return `toast-${counter}`;
}

/**
 * Dispara um toast.
 *
 * Pode ser chamada de fora de componentes React (ex.: utilitário que
 * trata `ActionResult.error`). A função é estável e segura para uso em
 * `useEffect` sem dependências.
 *
 * Retorna helpers para atualizar ou descartar este toast específico.
 */
export function toast(descriptor: ToastDescriptor): {
    id: string;
    dismiss: () => void;
} {
    const id = descriptor.id ?? nextId();
    dispatch({
        type: "ADD",
        toast: {
            ...descriptor,
            id,
            open: true,
        },
    });
    return {
        id,
        dismiss: () => dispatch({ type: "DISMISS", id }),
    };
}

/**
 * Hook React para componentes que renderizam toasts (ex.: `Toaster`)
 * ou que precisam disparar/descartar dinamicamente.
 */
export function useToast(): {
    toasts: ActiveToast[];
    toast: typeof toast;
    dismiss: (id?: string) => void;
} {
    const state = React.useSyncExternalStore(
        subscribe,
        getSnapshot,
        getSnapshot,
    );

    return {
        toasts: state.toasts,
        toast,
        dismiss: (id?: string) => dispatch({ type: "DISMISS", id }),
    };
}

// Export interno reutilizado pelo `Toaster` em `toaster.tsx`.
export const __internal = {
    dispatch,
    TOAST_DEFAULT_DURATION_MS,
};
