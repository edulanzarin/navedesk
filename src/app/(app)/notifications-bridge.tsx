/**
 * `NotificationsBridge` — ponte entre o servidor e o navegador.
 *
 * Responsabilidades:
 *
 * 1. **Pedido de permissão** — uma única vez, persistido em
 *    `localStorage`, exibe um toast pedindo autorização para
 *    notificações desktop nativas.
 *
 * 2. **EventSource (SSE)** — abre `/api/events` e reage aos eventos
 *    publicados via Postgres LISTEN/NOTIFY:
 *    - `notification`: dispara notificação desktop (quando permitida)
 *      e atualiza o contador local incrementando.
 *    - `notification_read`: zera o contador local imediatamente.
 *    - `ticket_changed` / `tickets_list_changed` / `users_changed`:
 *      apenas refresh para Server Components reexecutarem.
 *
 * 3. **Título da aba** — sempre que o contador muda, prefixa o
 *    `document.title` com `(N) ` para que abas em segundo plano
 *    mostrem o número de pendências. Restaura o título original
 *    quando o contador zera.
 *
 * 4. **Sincronização** — chama `router.refresh()` em todos os eventos
 *    relevantes para que dados vindos do servidor (badge da Sidebar,
 *    listagens) reflitam a mudança.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { toast } from "@/components/ui/use-toast";

const PERMISSION_PROMPT_KEY = "navedesk:notifications-prompt-shown";

export interface NotificationsBridgeProps {
    /** Contador inicial calculado pelo Server Component pai. */
    initialUnread: number;
}

export function NotificationsBridge({
    initialUnread,
}: NotificationsBridgeProps) {
    const router = useRouter();
    const [unread, setUnread] = React.useState(initialUnread);

    // Sempre que o servidor recalcula (router.refresh ou navegação),
    // o `initialUnread` chega novo via prop. Sincronizamos o estado
    // local — assim o título da aba também reflete.
    React.useEffect(() => {
        setUnread(initialUnread);
    }, [initialUnread]);

    // Título da aba — prefixa com `(N) ` quando há não-lidas. Restaura
    // o título base quando zera. Persistimos o título base num ref
    // pra detectar quando o Next muda (ex.: navegação entre rotas).
    const baseTitleRef = React.useRef<string>("");
    React.useEffect(() => {
        if (typeof document === "undefined") return;

        // Captura o título atual sem o prefixo `(N) `, caso tenha.
        const current = document.title;
        const stripped = current.replace(/^\(\d+\)\s+/, "");

        // Atualiza o título base sempre que ele muda externamente
        // (mudança de rota, etc.). O regex remove qualquer prefixo
        // antigo pra não acumular.
        baseTitleRef.current = stripped;

        document.title =
            unread > 0 ? `(${unread}) ${stripped}` : stripped;
    }, [unread]);

    // Pedido de permissão na primeira montagem.
    React.useEffect(() => {
        if (typeof window === "undefined") return;
        if (typeof Notification === "undefined") return;
        if (Notification.permission !== "default") return;

        const alreadyAsked = window.localStorage.getItem(
            PERMISSION_PROMPT_KEY,
        );
        if (alreadyAsked === "1") return;

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

        const refresh = () => router.refresh();

        const onNotification = (ev: MessageEvent<string>) => {
            // Incrementa o contador local imediatamente — a UI reage
            // antes do `router.refresh()` completar.
            setUnread((n) => n + 1);
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

        // Quando o usuário lê tudo (ex.: entrou em /notificacoes em
        // outra aba), zeramos imediatamente sem esperar o refresh.
        const onNotificationRead = () => {
            setUnread(0);
            refresh();
        };

        source.addEventListener("notification", onNotification);
        source.addEventListener("notification_read", onNotificationRead);
        source.addEventListener("ticket_changed", refresh);
        source.addEventListener("tickets_list_changed", refresh);
        source.addEventListener("users_changed", refresh);

        source.onerror = () => {
            // EventSource reconecta sozinho — apenas swallow.
        };

        return () => {
            source.removeEventListener("notification", onNotification);
            source.removeEventListener(
                "notification_read",
                onNotificationRead,
            );
            source.removeEventListener("ticket_changed", refresh);
            source.removeEventListener("tickets_list_changed", refresh);
            source.removeEventListener("users_changed", refresh);
            source.close();
        };
    }, [router]);

    return null;
}
