/**
 * `NotificationsList` — Client Component com paginação cursor-based.
 *
 * Recebe a primeira página renderizada pelo servidor e, ao usuário
 * pedir mais resultados, busca a próxima via Server Action. As linhas
 * são serializáveis (datas como ISO strings) para atravessarem a
 * borda RSC.
 */

"use client";

import * as React from "react";

import Link from "next/link";

import {
    AlertCircle,
    CheckCircle2,
    Inbox,
    MessageSquare,
    Star,
    UserCheck,
    UserX,
} from "lucide-react";

import { loadMoreNotificationsAction } from "@/actions/notifications-load";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/format";
import type { NotificationCursor } from "@/db/repositories/notifications.repo";

type NotificationType =
    | "ticket_created"
    | "ticket_assigned"
    | "ticket_unassigned"
    | "ticket_status_changed"
    | "ticket_priority_changed"
    | "ticket_resolved"
    | "ticket_closed"
    | "message_public"
    | "message_internal"
    | "ticket_rated";

export interface SerializableNotification {
    id: string;
    userId: string;
    ticketId: string | null;
    type: NotificationType;
    title: string;
    body: string | null;
    actorId: string | null;
    readAt: string | null;
    createdAt: string;
}

export interface NotificationsListProps {
    initialRows: SerializableNotification[];
    initialCursor: NotificationCursor | null;
}

const ICON_FOR_TYPE: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
    ticket_created: Inbox,
    ticket_assigned: UserCheck,
    ticket_unassigned: UserX,
    ticket_status_changed: AlertCircle,
    ticket_priority_changed: AlertCircle,
    ticket_resolved: CheckCircle2,
    ticket_closed: CheckCircle2,
    message_public: MessageSquare,
    message_internal: MessageSquare,
    ticket_rated: Star,
};

const ICON_TONE_FOR_TYPE: Record<NotificationType, string> = {
    ticket_created: "text-(--blue) bg-(--blue-soft)",
    ticket_assigned: "text-(--accent) bg-(--accent-soft)",
    ticket_unassigned: "text-(--ink-3) bg-(--grey-soft)",
    ticket_status_changed: "text-(--amber) bg-(--amber-soft)",
    ticket_priority_changed: "text-(--amber) bg-(--amber-soft)",
    ticket_resolved: "text-(--green) bg-(--green-soft)",
    ticket_closed: "text-(--ink-3) bg-(--grey-soft)",
    message_public: "text-(--accent) bg-(--accent-soft)",
    message_internal: "text-(--amber) bg-(--amber-soft)",
    ticket_rated: "text-(--amber) bg-(--amber-soft)",
};

export function NotificationsList({
    initialRows,
    initialCursor,
}: NotificationsListProps) {
    const [rows, setRows] = React.useState(initialRows);
    const [cursor, setCursor] = React.useState<NotificationCursor | null>(
        initialCursor,
    );
    const [loading, setLoading] = React.useState(false);

    async function loadMore() {
        if (!cursor || loading) return;
        setLoading(true);
        try {
            const result = await loadMoreNotificationsAction(cursor);
            if (result.ok) {
                setRows((prev) => [...prev, ...result.data.rows]);
                setCursor(result.data.nextCursor);
            }
        } finally {
            setLoading(false);
        }
    }

    if (rows.length === 0) {
        return (
            <EmptyState
                icon={<Inbox />}
                title="Nenhuma notificação"
                description="Quando algo acontecer em chamados que envolvem você, aparece aqui."
            />
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
                {rows.map((notification) => {
                    const Icon = ICON_FOR_TYPE[notification.type];
                    const tone = ICON_TONE_FOR_TYPE[notification.type];
                    const wasUnread = notification.readAt === null;

                    const inner = (
                        <div
                            className={cn(
                                "flex items-start gap-3 rounded-(--r-3) border border-hairline border-(--line) bg-(--bg-elev) p-4",
                                "transition-colors duration-[var(--dur-fast)]",
                                "hover:bg-black/[0.02]",
                                wasUnread && "border-l-[3px] border-l-(--accent)",
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-(--r-2)",
                                    tone,
                                )}
                            >
                                <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="truncate text-sm font-medium text-(--ink)">
                                        {notification.title}
                                    </p>
                                    <span className="shrink-0 text-xs text-(--ink-4) tabular-nums">
                                        {relTime(new Date(notification.createdAt))}
                                    </span>
                                </div>
                                {notification.body ? (
                                    <p className="mt-1 text-sm text-(--ink-3)">
                                        {notification.body}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    );

                    return (
                        <li key={notification.id}>
                            {notification.ticketId ? (
                                <Link
                                    href={`/tickets/${notification.ticketId}`}
                                    className="block outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 rounded-(--r-3)"
                                >
                                    {inner}
                                </Link>
                            ) : (
                                inner
                            )}
                        </li>
                    );
                })}
            </ul>
            {cursor ? (
                <div className="mt-2 flex justify-center">
                    <Button
                        variant="default"
                        onClick={loadMore}
                        loading={loading}
                    >
                        Carregar mais
                    </Button>
                </div>
            ) : (
                <p className="mt-4 text-center text-xs text-(--ink-4)">
                    Você chegou ao fim das notificações.
                </p>
            )}
        </div>
    );
}
