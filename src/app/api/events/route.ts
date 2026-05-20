/**
 * SSE endpoint — `/api/events`.
 *
 * Cada client (navegador) abre uma conexão Server-Sent Events
 * persistente aqui após login. O servidor atende registrando um
 * listener no `RealtimeBus` (que escuta o canal `navedesk_events`
 * no Postgres via LISTEN/NOTIFY).
 *
 * Quando uma mutação é commitada, o serviço de domínio publica um
 * `RealtimeEvent` no canal. O Postgres encaminha pra todos os
 * processos que fazem LISTEN, o `RealtimeBus` distribui para cada
 * SSE conectado, e cada SSE filtra por `userId` quando apropriado.
 *
 * No navegador, o `NotificationsBridge` recebe via `EventSource` e
 * dispara `router.refresh()` — Server Components reexecutam,
 * atualizando dados em tempo real sem reload completo.
 *
 * Heartbeat: a cada 25s mandamos um comentário SSE (`:`) para
 * manter a conexão viva atrás de proxies que matam conexões idle.
 */

import { auth } from "@/lib/auth";
import { getRealtimeBus, type RealtimeEvent } from "@/lib/realtime";
import type { SessionUser } from "@/types/domain";

/** Roda em Node runtime — precisamos de `pg.Client` para LISTEN. */
export const runtime = "nodejs";
/** Nunca cachear — é stream contínuo. */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
    const session = await auth();
    const user = (session?.user as SessionUser | undefined) ?? null;
    if (!user) {
        return new Response("Unauthorized", { status: 401 });
    }

    const bus = getRealtimeBus();
    await bus.ensureListener();

    const encoder = new TextEncoder();

    // Closures compartilhadas entre `start` e `cancel`.
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let onEvent: ((event: RealtimeEvent) => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (chunk: string) => {
                try {
                    controller.enqueue(encoder.encode(chunk));
                } catch {
                    // Stream já fechado.
                }
            };

            // Hello inicial para confirmar conexão.
            send(`event: ready\ndata: {"ok":true}\n\n`);

            // Filtro por userId quando o evento é dirigido.
            onEvent = (event: RealtimeEvent) => {
                if (event.userId && event.userId !== user.id) return;
                send(
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );
            };
            bus.on("event", onEvent);

            heartbeat = setInterval(() => {
                send(`: heartbeat\n\n`);
            }, HEARTBEAT_MS);

            // Quando o cliente aborta a conexão (fechou aba, navegou
            // pra outra rota com EventSource diferente), o
            // `request.signal` dispara `abort`. Limpa os recursos.
            request.signal.addEventListener("abort", () => {
                if (heartbeat) clearInterval(heartbeat);
                if (onEvent) bus.off("event", onEvent);
                try {
                    controller.close();
                } catch {
                    // Já fechado.
                }
            });
        },
        cancel() {
            // Backup do cleanup caso o stream seja cancelado por
            // outra via que não dispare `request.signal`.
            if (heartbeat) clearInterval(heartbeat);
            if (onEvent) bus.off("event", onEvent);
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
