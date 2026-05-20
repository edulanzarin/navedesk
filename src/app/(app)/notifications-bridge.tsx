/**
 * `NotificationsBridge` — ponte entre o servidor e o navegador para
 * notificações desktop nativas (Web Notifications API).
 *
 * Comportamento:
 *
 * 1. **Pedido de permissão**: na primeira montagem, se o navegador
 *    suporta `Notification` e a permissão ainda é `default`, exibe um
 *    pequeno toast de cortesia perguntando se o usuário quer receber
 *    notificações desktop. O clique em "Ativar" chama
 *    `Notification.requestPermission()`. Se o usuário negar, o
 *    componente respeita e nunca mais pergunta — o estado fica em
 *    `localStorage` para que recarregar a página não reaprove.
 *
 * 2. **Polling**: a cada 30s chama `getUnreadCountAction` para saber
 *    quantas não-lidas o usuário tem. Quando o contador **aumenta**
 *    em relação ao anterior, dispara uma notificação desktop com o
 *    título "Navedesk: novas notificações" e leva o usuário a
 *    `/notificacoes` ao clicar.
 *
 * 3. **Atualização do badge**: quando o contador muda, faz um
 *    `router.refresh()` para que o Server Component pai recarregue
 *    `getSidebarCounts` e o badge da Sidebar reflita o novo estado
 *    sem reload completo.
 *
 * Esse componente fica sempre montado no `(app)/layout.tsx`, então
 * funciona em qualquer rota autenticada do produto.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { getUnreadCountAction } from "@/actions/notifications";
import { toast } from "@/components/ui/use-toast";

const POLL_INTERVAL_MS = 30_000;
const PERMISSION_PROMPT_KEY = "navedesk:notifications-prompt-shown";

export interface NotificationsBridgeProps {
    /** Contador inicial calculado pelo Server Component pai. */
    initialUnread: number;
}

export function NotificationsBridge({
    initialUnread,
}: NotificationsBridgeProps) {
    const router = useRouter();
    // Mantém o último contador conhecido em ref para que o polling
    // detecte aumentos sem depender de re-render.
    const lastCountRef = React.useRef(initialUnread);

    // Pedido de permissão na primeira montagem.
    React.useEffect(() => {
        if (typeof window === "undefined") return;
        if (typeof Notification === "undefined") return;
        if (Notification.permission !== "default") return;

        const alreadyAsked = window.localStorage.getItem(
            PERMISSION_PROMPT_KEY,
        );
        if (alreadyAsked === "1") return;

        // Marca antes de pedir para que não façamos prompt em loop
        // caso o usuário simplesmente feche o toast.
        window.localStorage.setItem(PERMISSION_PROMPT_KEY, "1");

        toast({
            variant: "info",
            title: "Receber notificações no desktop?",
            description:
                "Permita para ser avisado de novas atividades em chamados.",
            action: {
                label: "Ativar",
                onClick: () => {
                    Notification.requestPermission().then((perm) => {
                        if (perm === "granted") {
                            toast({
                                variant: "success",
                                title: "Notificações ativadas",
                            });
                        }
                    });
                },
            },
            duration: 12_000,
        });
    }, []);

    // Polling do contador.
    React.useEffect(() => {
        let cancelled = false;

        async function poll() {
            const result = await getUnreadCountAction();
            if (cancelled) return;
            if (!result.ok) return;

            const next = result.data.count;
            const previous = lastCountRef.current;

            if (next > previous) {
                // Notificação desktop quando suportado e permitido.
                if (
                    typeof Notification !== "undefined" &&
                    Notification.permission === "granted"
                ) {
                    const delta = next - previous;
                    const n = new Notification("Navedesk", {
                        body:
                            delta === 1
                                ? "Você tem 1 nova notificação."
                                : `Você tem ${delta} novas notificações.`,
                        icon: "/navedesk.png",
                        tag: "navedesk-unread",
                        // `renotify` faz o sistema operacional avisar
                        // mesmo que já exista uma notificação com
                        // mesma `tag`.
                        renotify: true,
                    });
                    n.onclick = () => {
                        window.focus();
                        router.push("/notificacoes");
                        n.close();
                    };
                }
                // Refresh para o badge da Sidebar reagir.
                router.refresh();
            } else if (next < previous) {
                // Diminuiu (ex.: usuário entrou em /notificacoes em
                // outra aba). Apenas atualiza referência sem refresh
                // — o próximo navigate já refletirá.
                router.refresh();
            }

            lastCountRef.current = next;
        }

        const interval = window.setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [router]);

    return null;
}
