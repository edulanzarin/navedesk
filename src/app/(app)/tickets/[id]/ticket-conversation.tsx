/**
 * `TicketConversation` — Client Component que renderiza a thread de
 * mensagens de um ticket e o composer para postar novas mensagens
 * (públicas e, quando permitido, notas internas).
 *
 * Contrato e responsabilidades:
 *
 * - Recebe a lista de `messages` já filtrada pela visibilidade do
 *   papel: o Server Component (`page.tsx`) carrega via
 *   `listMessagesForUser`, que esconde notas internas para
 *   solicitantes (R7.4). Este componente apenas renderiza o que
 *   chega — não toma decisão sobre incluir/ocultar notas.
 * - Resolve nome e cor de avatar dos autores via `authorsById`,
 *   passado pelo servidor já materializado a partir de uma única
 *   consulta `inArray(users.id, ...)` (evita N+1).
 * - Composer: textarea + botão "Enviar" + checkbox "Nota interna"
 *   (esta última só aparece quando `canPostInternal === true`,
 *   espelhando `canPostInternalNote` do RBAC; R7.3, R12.3).
 * - Submit roda dentro de `useTransition` para que o botão entre em
 *   `loading` enquanto a Server Action está em voo. Em sucesso,
 *   limpa o campo e confia no `revalidatePath` da action para a
 *   próxima renderização trazer a mensagem do banco com `createdAt`
 *   canônico do Postgres (R7.7).
 * - Toasts de sucesso/erro via `@/components/ui/use-toast`.
 *
 * Visibilidade visual:
 *
 * - Cada mensagem mostra `Avatar` colorido, nome do autor, tempo
 *   relativo e o corpo. Notas internas ganham um destaque âmbar
 *   (borda esquerda + fundo soft) e o badge "Nota interna" para que
 *   técnicos não confundam o público da mensagem.
 *
 * Validates: R7.1, R7.2, R7.3, R7.4, R7.5, R7.7, R7.8, R12.3.
 */

"use client";

import * as React from "react";

import { Paperclip } from "lucide-react";

import { postMessageAction } from "@/actions/messages";
import { AttachmentChip } from "@/components/domain/attachment-chip";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/error-messages";
import { relTime } from "@/lib/format";
import { UploadConstraints } from "@/lib/schemas";
import type { SessionUser } from "@/types/domain";

/**
 * Forma serializável da mensagem entregue pelo Server Component.
 *
 * `createdAt` chega como `Date` quando o componente cliente é
 * renderizado a partir de RSC; o Next 15 lida com a serialização
 * automaticamente. Mantemos o tipo aqui em vez de reusar
 * `MessageRow` para não acoplar o componente de UI ao schema do
 * Drizzle e para deixar explícito que `id`, `body`, `isInternal`,
 * `authorId` e `createdAt` são os únicos campos consumidos.
 */
export interface ConversationMessage {
    id: string;
    body: string;
    isInternal: boolean;
    authorId: string;
    createdAt: Date;
    /** Anexos vinculados a esta mensagem específica (R7, R8). */
    attachments?: ReadonlyArray<MessageAttachment>;
}

/**
 * Anexo de mensagem — apenas o que a UI precisa pra montar o chip.
 */
export interface MessageAttachment {
    id: string;
    name: string;
    size: number;
    mime: string;
}

/**
 * Resumo do autor de uma mensagem — basta o necessário para o
 * cabeçalho de cada bolha (nome + cor + foto opcional). O servidor
 * monta este mapa em uma única consulta.
 */
export interface ConversationAuthor {
    id: string;
    name: string;
    avatarColor: string;
    avatarUrl: string | null;
}

export interface TicketConversationProps {
    /** ID legível do ticket (`NVD-XXXX`). */
    ticketId: string;
    /** Mensagens já escopadas por papel, ordenadas cronologicamente. */
    messages: readonly ConversationMessage[];
    /** Mapa `authorId → autor` para resolver nome/cor sem fetch extra. */
    authorsById: Record<string, ConversationAuthor>;
    /** Usuário autenticado — usado para destacar mensagens próprias. */
    currentUser: SessionUser;
    /** Quando `true`, exibe o toggle "Nota interna" no composer. */
    canPostInternal: boolean;
    /**
     * Quando `true`, omite o `Card` wrapper externo e renderiza apenas
     * o conteúdo (lista com scroll + composer). Útil para embutir em
     * um `<TabsContent>` que já provê o card e o cabeçalho.
     */
    bare?: boolean;
    /**
     * Quando definido, esconde o composer público e exibe um aviso em
     * pt-BR no lugar (R7.10, R12.5). Técnicos/admins ainda podem
     * postar **notas internas** quando `canPostInternal === true`,
     * porque ações administrativas não são impedidas pelo
     * resolvido/fechado da máquina de estados.
     *
     * Casos típicos:
     *   - status === "resolvido"  → "O ticket foi marcado como resolvido. ..."
     *   - status === "fechado"    → "O ticket está fechado. ..."
     */
    lockedMessage?: string;
}

/** Limite máximo do `body` em sincronia com `PostMessageSchema` (R7.1). */
const BODY_MAX_LENGTH = 5000;

/**
 * Bolha de mensagem individual.
 *
 * Notas internas ganham:
 *   - Fundo `--amber-soft` e borda esquerda em `--amber`, estabelecendo
 *     hierarquia visual sem usar cor diferente para o texto (mantém
 *     contraste WCAG sobre o tom suave).
 *   - Badge "Nota interna" alinhado ao nome do autor.
 *
 * Mensagens públicas ficam sobre fundo elevado padrão. O autor da
 * mensagem nunca é diferente do `currentUser` na maioria dos casos —
 * mantemos o layout uniforme em vez de espelhar o estilo "chat" para
 * que o histórico fique mais próximo de um log de atendimento.
 */
/**
 * Renderiza o corpo da mensagem destacando tokens `@nome`. O React
 * escapa automaticamente cada string fragmentada — não criamos HTML
 * arbitrário, então é seguro contra XSS.
 */
function renderBodyWithMentions(body: string): React.ReactNode {
    const re = /@([a-zA-ZÀ-ÿ0-9_]+(?:\.[a-zA-ZÀ-ÿ0-9_]+)?)/g;
    const out: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = re.exec(body)) !== null) {
        if (match.index > last) {
            out.push(body.slice(last, match.index));
        }
        out.push(
            <span
                key={`m-${key++}`}
                className="rounded-(--r-1) bg-(--accent-soft) px-1 font-medium text-(--accent)"
            >
                {match[0]}
            </span>,
        );
        last = match.index + match[0].length;
    }
    if (last < body.length) out.push(body.slice(last));
    return out;
}

function MessageBubble({
    message,
    author,
}: {
    message: ConversationMessage;
    author: ConversationAuthor | undefined;
}) {
    const authorName = author?.name ?? "Usuário removido";
    const authorColor = author?.avatarColor;
    const authorUrl = author?.avatarUrl;

    return (
        <article
            className={cn(
                "flex gap-3 rounded-(--r-3) border border-(--line) bg-(--bg-elev) p-3",
                message.isInternal &&
                "border-l-4 border-l-(--amber) bg-(--amber-soft)",
            )}
            aria-label={
                message.isInternal
                    ? `Nota interna de ${authorName}`
                    : `Mensagem de ${authorName}`
            }
        >
            <Avatar
                name={authorName}
                {...(authorColor ? { color: authorColor } : {})}
                {...(authorUrl ? { src: authorUrl } : {})}
                size="md"
            />
            <div className="min-w-0 flex-1">
                <header className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="min-w-0 max-w-full truncate text-sm font-medium text-(--ink)" title={authorName}>
                        {authorName}
                    </span>
                    {message.isInternal ? (
                        <Badge tone="amber">Nota interna</Badge>
                    ) : null}
                    <span
                        className="text-xs text-(--ink-3)"
                        title={message.createdAt.toISOString()}
                    >
                        {relTime(message.createdAt)}
                    </span>
                </header>
                {/*
                  Markdown sanitizado fica como evolução futura
                  (R7.6 — `react-markdown` + `rehype-sanitize`). Para
                  esta entrega, preservamos quebras de linha com
                  `whitespace-pre-wrap` e renderizamos texto puro,
                  inerte do ponto de vista de XSS porque React escapa
                  automaticamente o conteúdo. Tokens `@nome` são
                  destacados visualmente.
                */}
                <div className="whitespace-pre-wrap break-words text-sm text-(--ink-2)">
                    {renderBodyWithMentions(message.body)}
                </div>
                {message.attachments && message.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {message.attachments.map((a) => (
                            <AttachmentChip
                                key={a.id}
                                id={a.id}
                                name={a.name}
                                size={a.size}
                                mime={a.mime}
                                href={`/api/uploads/${a.id}`}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

export function TicketConversation({
    ticketId,
    messages,
    authorsById,
    canPostInternal,
    bare = false,
    lockedMessage,
}: TicketConversationProps): React.ReactElement {
    const [body, setBody] = React.useState("");
    const [isInternal, setIsInternal] = React.useState(false);
    const [isPending, startTransition] = React.useTransition();
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = React.useState(false);
    const [pendingAttachments, setPendingAttachments] = React.useState<
        MessageAttachment[]
    >([]);

    /**
     * Container rolável com a thread de mensagens. Usamos `ref` em vez
     * de `scrollIntoView` porque o ancestral natural (a página inteira)
     * também rola, e queríamos rolar apenas a lista.
     */
    const scrollerRef = React.useRef<HTMLDivElement | null>(null);

    /**
     * Auto-scroll para o fundo sempre que o número de mensagens muda
     * (incluindo a primeira renderização). Em conversas longas isso
     * mantém a última troca visível sem o usuário precisar rolar — o
     * mesmo padrão usado em interfaces de chat.
     */
    React.useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    /** Habilita o submit quando há texto e nada está em voo (anexos sozinhos exigem ao menos uma palavra de contexto). */
    const trimmedLength = body.trim().length;
    const canSubmit = trimmedLength > 0 && !isPending && !uploading;

    /**
     * Faz upload incremental ao escolher arquivo(s). Mesma estratégia
     * do `TicketForm`: cada arquivo dispara um POST e, ao concluir,
     * vai pra lista local. Erros viram toast e o arquivo é descartado.
     */
    async function handleFiles(files: FileList | null): Promise<void> {
        if (!files || files.length === 0) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/api/uploads", {
                    method: "POST",
                    body: fd,
                });
                if (!res.ok) {
                    let body: { message?: string } = {};
                    try {
                        body = (await res.json()) as { message?: string };
                    } catch {
                        // Resposta sem JSON.
                    }
                    toast({
                        variant: "error",
                        title: "Falha ao enviar anexo",
                        description: body.message ?? file.name,
                    });
                    continue;
                }
                const data = (await res.json()) as {
                    id: string;
                    name: string;
                    size: number;
                    mime: string;
                };
                setPendingAttachments((prev) => [
                    ...prev,
                    {
                        id: data.id,
                        name: data.name,
                        size: data.size,
                        mime: data.mime,
                    },
                ]);
            }
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }

    function removeAttachment(id: string): void {
        setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        if (!canSubmit) return;

        // Quando o ticket está travado e o ator é técnico/admin,
        // qualquer envio é forçado a `isInternal=true`. Para
        // solicitantes o composer nem é renderizado, então não há
        // submit possível.
        const lockedInternalOnly =
            lockedMessage !== undefined && canPostInternal;

        // Captura snapshot do estado para usar no callback async — depois
        // do `setBody("")` o estado pode ser reciclado pelo React.
        const payload = {
            body: body.trim(),
            isInternal:
                lockedInternalOnly || (canPostInternal && isInternal),
            attachments: pendingAttachments.map((a) => a.id),
        };

        startTransition(async () => {
            const result = await postMessageAction(ticketId, payload);
            if (result.ok) {
                setBody("");
                setIsInternal(false);
                setPendingAttachments([]);
                // Devolve o foco ao textarea para que o usuário possa
                // continuar digitando sem precisar tocar no mouse —
                // padrão usado em interfaces de chat/log.
                textareaRef.current?.focus();
                toast({
                    variant: "success",
                    title: payload.isInternal
                        ? "Nota interna registrada"
                        : "Mensagem enviada",
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível enviar a mensagem",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    // Determinação do que renderizar abaixo da lista:
    //
    // - Sem `lockedMessage` → composer normal (público + opcional nota interna).
    // - Com `lockedMessage` e `canPostInternal === false` → apenas o aviso
    //   em pt-BR (solicitantes e técnicos sem permissão de nota interna).
    // - Com `lockedMessage` e `canPostInternal === true` → aviso + composer
    //   forçado em modo "nota interna" (técnicos/admins continuam podendo
    //   anotar internamente mesmo após o ticket ser resolvido/fechado).
    const isLocked = lockedMessage !== undefined;
    const showInternalOnly = isLocked && canPostInternal;
    const effectiveIsInternal = showInternalOnly ? true : isInternal;

    const composer = (
        <form
            onSubmit={handleSubmit}
            className="mt-2 flex flex-col gap-2 border-t border-(--line) pt-4"
            noValidate
        >
            <label
                htmlFor="ticket-message-body"
                className="text-sm font-medium text-(--ink)"
            >
                {showInternalOnly ? "Nova nota interna" : "Nova mensagem"}
            </label>
            <Textarea
                id="ticket-message-body"
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                    showInternalOnly || (canPostInternal && isInternal)
                        ? "Escreva uma nota interna visível apenas a técnicos e admins…"
                        : "Escreva sua mensagem…"
                }
                maxLength={BODY_MAX_LENGTH}
                disabled={isPending}
                required
            />

            {/* Anexos pendentes (já enviados pro servidor, aguardando o
                submit da mensagem pra serem vinculados). */}
            {pendingAttachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((a) => (
                        <AttachmentChip
                            key={a.id}
                            id={a.id}
                            name={a.name}
                            size={a.size}
                            mime={a.mime}
                            onRemove={removeAttachment}
                        />
                    ))}
                </div>
            ) : null}

            {/* Input de arquivo escondido — disparado pelo botão Paperclip. */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={UploadConstraints.allowedMime.join(",")}
                className="sr-only"
                onChange={(e) => {
                    void handleFiles(e.target.files);
                }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading || isPending}
                        className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-(--r-2) border border-(--line) bg-(--bg-elev) px-2.5 text-xs font-medium text-(--ink-2)",
                            "transition-colors hover:bg-(--bg-sunk) hover:text-(--ink)",
                            "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                    >
                        <Paperclip className="size-3.5" aria-hidden="true" />
                        {uploading ? "Enviando…" : "Anexar"}
                    </button>
                    {showInternalOnly ? (
                        <span className="inline-flex items-center gap-2 text-xs text-(--amber)">
                            <Badge tone="amber">Nota interna</Badge>
                            Apenas técnicos e admins veem esta mensagem.
                        </span>
                    ) : canPostInternal ? (
                        <label className="inline-flex items-center gap-2 text-sm text-(--ink-2)">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-(--line) text-(--accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
                                checked={effectiveIsInternal}
                                onChange={(e) => setIsInternal(e.target.checked)}
                                disabled={isPending}
                            />
                            Nota interna
                        </label>
                    ) : null}
                </div>
                <div className="flex items-center gap-3">
                    <span
                        className="text-xs text-(--ink-4) tabular-nums"
                        aria-live="polite"
                    >
                        {body.length}/{BODY_MAX_LENGTH}
                    </span>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={isPending}
                        disabled={!canSubmit}
                    >
                        Enviar
                    </Button>
                </div>
            </div>
        </form>
    );

    const lockedNotice = isLocked ? (
        <div
            role="status"
            className="rounded-(--r-3) border border-(--amber) bg-(--amber-soft) px-4 py-3 text-sm text-(--ink-2)"
        >
            {lockedMessage}
        </div>
    ) : null;

    const content = (
        <div className="flex flex-col gap-3">
            {messages.length === 0 ? (
                <p className="text-sm text-(--ink-3)">
                    Nenhuma mensagem ainda.
                </p>
            ) : (
                <div
                    ref={scrollerRef}
                    className="h-96 overflow-y-auto pr-1"
                >
                    <ol className="flex flex-col gap-3">
                        {messages.map((message) => (
                            <li key={message.id}>
                                <MessageBubble
                                    message={message}
                                    author={authorsById[message.authorId]}
                                />
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {lockedNotice}

            {/* Composer:
                  - Travado para solicitantes (não veem composer)
                  - Mantido para técnicos/admins postarem nota interna
                  - Normal nos demais casos */}
            {isLocked && !canPostInternal ? null : composer}
        </div>
    );

    if (bare) {
        return content;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Conversa</CardTitle>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
    );
}
