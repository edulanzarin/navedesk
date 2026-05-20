/**
 * `TicketTabs` — barra de abas persistentes pra navegar entre vários
 * tickets sem perder contexto.
 *
 * Comportamento:
 * - Cada vez que o usuário visita `/tickets/{id}`, registramos a aba
 *   localmente (com título inferido do `<title>` da página).
 * - As abas ficam visíveis abaixo da topbar, em qualquer rota.
 * - Click numa aba navega para o ticket correspondente.
 * - Cada aba tem um botão de fechar (×).
 * - Persistência: `localStorage` por usuário, sobrevive a reload e
 *   reconexão SSE.
 *
 * Decisões:
 * - Limite máximo de 8 abas; a 9ª substitui a mais antiga não-ativa.
 *   Guard contra acúmulo desnecessário (ninguém precisa de 30 tickets
 *   abertos ao mesmo tempo).
 * - Não usamos URL fragmentada / sub-rotas — a UX de tabs é puramente
 *   client-side; a navegação real continua por path normal.
 * - Apenas tickets entram nas tabs. Outras páginas (dashboard,
 *   /admin/...) usam navegação tradicional.
 */

"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { X } from "lucide-react";

import { cn } from "@/lib/cn";

const STORAGE_KEY = "navedesk:ticket-tabs";
const MAX_TABS = 8;
/** Regex que identifica `/tickets/NVD-123` (não bate com `/tickets/novo` etc). */
const TICKET_PATH_RE = /^\/tickets\/(NVD-\d+)$/;

interface TicketTab {
    id: string;
    /** Title fica fluído — começa com o ID e vira o título real depois. */
    title: string;
}

function readTabs(): TicketTab[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (t): t is TicketTab =>
                    typeof t === "object" &&
                    t !== null &&
                    "id" in t &&
                    "title" in t &&
                    typeof (t as TicketTab).id === "string" &&
                    typeof (t as TicketTab).title === "string",
            )
            .slice(0, MAX_TABS);
    } catch {
        return [];
    }
}

function writeTabs(tabs: TicketTab[]): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
        // Quota exceeded ou modo privado — fail silently.
    }
}

export function TicketTabs() {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [tabs, setTabs] = React.useState<TicketTab[]>([]);
    const [hydrated, setHydrated] = React.useState(false);

    // Hidrata do localStorage no mount.
    React.useEffect(() => {
        setTabs(readTabs());
        setHydrated(true);
    }, []);

    // Detecta entrada em uma página de ticket e adiciona/promove a aba.
    React.useEffect(() => {
        if (!hydrated) return;
        const match = pathname.match(TICKET_PATH_RE);
        if (!match) return;
        const id = match[1]!;

        setTabs((prev) => {
            const exists = prev.some((t) => t.id === id);
            // Pega o título do documento se disponível (Server Component
            // já setou em metadata). Cai no ID quando não encontra.
            const docTitle =
                typeof document !== "undefined" ? document.title : id;
            const cleanTitle =
                docTitle && docTitle !== "Navedesk"
                    ? docTitle.replace(/^\(\d+\)\s+/, "").replace(/\s+·.*$/, "")
                    : id;

            const next = exists
                ? prev.map((t) =>
                    t.id === id ? { ...t, title: cleanTitle || id } : t,
                )
                : [...prev, { id, title: cleanTitle || id }];

            // Limita ao MAX_TABS, removendo as mais antigas não-ativas.
            const limited =
                next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
            writeTabs(limited);
            return limited;
        });
    }, [pathname, hydrated]);

    // Atualiza título da aba ativa quando o documento muda
    // (ex.: `(2) NVD-1042 - …` → `NVD-1042 - …`).
    React.useEffect(() => {
        if (!hydrated) return;
        const match = pathname.match(TICKET_PATH_RE);
        if (!match) return;
        const id = match[1]!;

        const observer = new MutationObserver(() => {
            const docTitle = document.title;
            const cleanTitle = docTitle
                .replace(/^\(\d+\)\s+/, "")
                .replace(/\s+·.*$/, "");
            setTabs((prev) => {
                const updated = prev.map((t) =>
                    t.id === id && cleanTitle.length > 0
                        ? { ...t, title: cleanTitle }
                        : t,
                );
                writeTabs(updated);
                return updated;
            });
        });
        const titleEl = document.querySelector("title");
        if (titleEl) {
            observer.observe(titleEl, { childList: true, subtree: true });
        }
        return () => observer.disconnect();
    }, [pathname, hydrated]);

    function closeTab(id: string, e: React.MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();
        setTabs((prev) => {
            const next = prev.filter((t) => t.id !== id);
            writeTabs(next);
            // Se o usuário fechou a aba ativa, navega pra próxima
            // disponível ou pra lista de tickets.
            const match = pathname.match(TICKET_PATH_RE);
            if (match && match[1] === id) {
                if (next.length > 0) {
                    router.push(`/tickets/${next[next.length - 1]!.id}`);
                } else {
                    router.push("/tickets");
                }
            }
            return next;
        });
    }

    function clearAll(): void {
        setTabs([]);
        writeTabs([]);
        router.push("/tickets");
    }

    if (!hydrated || tabs.length === 0) return null;

    const activeMatch = pathname.match(TICKET_PATH_RE);
    const activeId = activeMatch ? activeMatch[1] : null;

    return (
        <div
            role="tablist"
            aria-label="Tickets abertos"
            className="flex h-9 items-center gap-1 overflow-x-auto border-b border-hairline border-(--line) bg-(--bg-elev-translucent) px-3 glass-panel"
        >
            {tabs.map((t) => {
                const isActive = activeId === t.id;
                return (
                    <Link
                        key={t.id}
                        href={`/tickets/${t.id}`}
                        role="tab"
                        aria-selected={isActive}
                        className={cn(
                            "group flex h-7 shrink-0 items-center gap-2 rounded-(--r-2) px-2.5 text-[12.5px] transition-colors",
                            isActive
                                ? "bg-(--accent-soft) text-(--accent)"
                                : "text-(--ink-2) hover:bg-black/[0.04]",
                        )}
                    >
                        <span
                            className="max-w-[180px] truncate font-medium"
                            title={t.title}
                        >
                            {t.title}
                        </span>
                        <button
                            type="button"
                            onClick={(e) => closeTab(t.id, e)}
                            aria-label={`Fechar aba ${t.id}`}
                            className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded-(--r-1) opacity-60 transition-opacity",
                                "hover:bg-black/[0.06] hover:opacity-100",
                            )}
                        >
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    </Link>
                );
            })}
            {tabs.length > 1 ? (
                <button
                    type="button"
                    onClick={clearAll}
                    className="ml-auto shrink-0 rounded-(--r-1) px-2 text-xs text-(--ink-3) hover:bg-black/[0.04] hover:text-(--ink-2)"
                >
                    Fechar tudo
                </button>
            ) : null}
        </div>
    );
}
