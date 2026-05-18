/**
 * `Toaster` — ponto único de montagem dos toasts.
 *
 * Wrapper que combina `ToastProvider` + `ToastViewport` e consome a
 * fila gerenciada por `useToast`. Deve ser renderizado uma única vez,
 * geralmente no `layout.tsx` raiz, dentro do `<body>`.
 *
 * Cada item da fila vira uma instância de `Toast` com seu título,
 * descrição, ação e variante. O `onOpenChange` propaga o fechamento
 * (clique no `ToastClose`, swipe, expiração) de volta ao store, e um
 * temporizador interno do Radix remove o nó do DOM ao fim da animação.
 *
 * Validates: R19.3, R22
 */

"use client";

import * as React from "react";

import {
    Toast,
    ToastAction,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
} from "@/components/ui/toast";
import { __internal, useToast } from "@/components/ui/use-toast";

export function Toaster() {
    const { toasts } = useToast();

    return (
        <ToastProvider duration={__internal.TOAST_DEFAULT_DURATION_MS} swipeDirection="right">
            {toasts.map(({ id, title, description, action, variant, duration, open }) => (
                <Toast
                    key={id}
                    variant={variant}
                    duration={duration}
                    open={open}
                    onOpenChange={(nextOpen) => {
                        __internal.dispatch({
                            type: "UPDATE_OPEN",
                            id,
                            open: nextOpen,
                        });
                        if (!nextOpen) {
                            // Remove do store após a animação de saída do Radix.
                            window.setTimeout(() => {
                                __internal.dispatch({ type: "REMOVE", id });
                            }, 300);
                        }
                    }}
                >
                    <div className="flex-1">
                        <ToastTitle>{title}</ToastTitle>
                        {description ? (
                            <ToastDescription>{description}</ToastDescription>
                        ) : null}
                    </div>
                    {action ? (
                        <ToastAction
                            altText={action.label}
                            onClick={action.onClick}
                        >
                            {action.label}
                        </ToastAction>
                    ) : null}
                    <ToastClose />
                </Toast>
            ))}
            <ToastViewport />
        </ToastProvider>
    );
}
