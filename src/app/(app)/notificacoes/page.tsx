/**
 * Página `/notificacoes` — caixa de notificações do usuário corrente.
 *
 * Server Component. Carrega a primeira página (cursor null) e marca
 * todas as não-lidas como lidas no momento da entrada (R "ao entrar
 * nessa aba, a notificação será lida"). A paginação subsequente é
 * conduzida pelo client via Server Action.
 *
 * O escopo é sempre `userId === session.user.id` — não dá pra ver
 * notificações de outras pessoas, defesa em profundidade no service.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/lib/auth";
import * as notificationsService from "@/services/notifications.service";
import type { SessionUser } from "@/types/domain";

import { NotificationsList } from "./notifications-list";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    // Marca tudo como lido antes de carregar — a UI mostra a página
    // já em estado "limpo" e o badge da Sidebar zera. Idempotente
    // se já estavam lidas.
    await notificationsService.markAllRead(user.id);

    // Primeira página de notificações (mais recentes primeiro).
    const firstPage = await notificationsService.listForUser(user.id, {
        limit: 20,
    });

    return (
        <div>
            <PageHeader
                title="Notificações"
                description="Atividades recentes em chamados que envolvem você."
            />
            <NotificationsList
                initialRows={firstPage.rows.map((row) => ({
                    ...row,
                    createdAt: row.createdAt.toISOString(),
                    readAt: row.readAt?.toISOString() ?? null,
                }))}
                initialCursor={firstPage.nextCursor}
            />
        </div>
    );
}
