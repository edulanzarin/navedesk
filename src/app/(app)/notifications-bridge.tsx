/**
 * `NotificationsBridge` — ponte entre o servidor e o navegador para
 * atualizações em tempo real.
 *
 * Comportamento:
 *
 * 1. **Pedido de permissão**: na primeira montagem, se o navegador
 *    suporta `Notification` e a permissão ainda é `default`, exibe
 *    um toast de cortesia perguntando se o usuário quer receber
 *    notificações desktop. Persiste o "já perguntei" em
 *    `localStorage` para não insistir.
 *
 * 2. **EventSource (SSE)**: abre uma conexão persistente em
 *    `/api/events`. O servidor envia eventos do tipo `notification`,
 *    `ticket_changed` e `tickets_list_changed` em tempo real, vindos
 *    do canal `navedesk_events` no Postgres (LISTEN/NOTIFY) — sem
 *    polling.
 *
 * 3. **Reação aos eventos**:
 *    - `notification`: dispara notificação desktop (quando permitida)
 *      e chama `router.refresh()` para atualizar o badge da Sidebar
 *      e a página de notificações se o usuário estiver nela.
 *    - `ticket_changed` / `tickets_list_changed`: chama
 *      `router.refresh()` para que Server Components reexecutem e
 *      mostrem dados frescos sem reload.
 *
 * 4. **Reconexão**: o `EventSource` reconecta sozinho em caso de
 *    queda. Apenas garantimos cleanup quando o componente desmonta.
 *
 * Esse componente fica sempre montado no `(app)/layout.tsx`, então
 * funciona em qualquer rota autenticada.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { toast } from "@/components/ui/use-toast";

const PERMISSION_PROMPT_KEY = "navedesk:notifications-prompt-shown";

export interface NotificationsBridgeProps {
    /**
     * Contador inicial calculado pelo Server Component pai. Mantido
     * apenas para compatibilidade — o estado real vem do refresh
     * disparado por cada evento SSE.
     */
    initialUnread: number;
}

export function NotificationsBridge(_props: NotificationsBridgeProps) {
    const router = useRouter();

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

    // SSE — atualizações em tempo real.
    React.useEffect(() => {
        if (typeof window === "undefined") return;
        if (typeof EventSource === "undefined") return;

        const source = new EventSource("/api/events");

        // Trigger genérico para Server Components reexecutarem. Usado
        // por todos os tipos de evento — o ganho de granularidade não
        // compensa o complexo invalidate seletivo no Next 15.
        const refresh = () => router.refresh();

        // Notificação pessoal: além de refrescar, dispara aviso
        // desktop nativo se o usuário tiver concedido permissão.
        const onNotification = (ev: MessageEvent<string>) => {
            // O usuário recebeu algo novo — UI atualiza.
            refresh();

            if (
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
            ) {
                let ticketId: string | undefined;
                try {
                    const parsed = JSON.parse(ev.data) as {
                        ticketId?: string;
                    };
                    ticketId = parsed.ticketId;
                } catch {
                    // ignora payload malformado
                }
                const n = new Notification("Navedesk", {
                    body: "Você tem uma nova notificação.",
                    icon: "/navedesk.png",
                    tag: "navedesk-unread",
                });
                n.onclick = () => {
                    window.focus();
                    if (ticketId) {
                        router.push(`/tickets/${ticketId}`);
                    } else {
                        router.push("/notificacoes");
                    }
                    n.close();
                };
            }
        };

        source.addEventListener("notification", onNotification);
        source.addEventListener("ticket_changed", refresh);
        source.addEventListener("tickets_list_changed", refresh);

        // Erro/queda — o EventSource tenta reconectar sozinho. Só
        // logamos para diagnóstico em dev.
        source.onerror = () => {
            // O readyState vai a CLOSED se o servidor recusou.
            // Em CONNECTING, é apenas tentativa de reconexão.
        };

        return () => {
            source.removeEventListener("notification", onNotification);
            source.removeEventListener("ticket_changed", refresh);
            source.removeEventListener("tickets_list_changed", refresh);
            source.close();
        };
    }, [router]);

    return null;
}
