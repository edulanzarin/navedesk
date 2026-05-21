/**
 * Página `/tickets/[id]` (Server Component).
 *
 * Exibe o detalhe de um ticket aplicando defesa em profundidade sobre as
 * regras de visibilidade: o filtro RBAC vive no SQL (via
 * `tickets.repo.findVisibleForUser`), portanto solicitantes que tentem
 * acessar tickets de terceiros recebem `null` aqui — exatamente o mesmo
 * caminho do "ticket inexistente" — e o componente delega ao
 * `notFound()` (R12.7: 404 sem revelar existência).
 *
 * Nesta fatia (tasks 22.1, 22.2 e 22.3) entregamos o esqueleto do
 * detalhe, a conversa interativa e a trilha de eventos:
 *
 * 1. **Cabeçalho** com identificador `NVD-XXXX`, título do ticket e
 *    subtítulo informando quem abriu e há quanto tempo. Os badges do
 *    estado atual aparecem logo abaixo do cabeçalho para que o leitor
 *    capte status/prioridade/categoria sem rolar (R12.1).
 * 2. **Coluna esquerda — Detalhes**: lista estruturada com status,
 *    prioridade, categoria, departamento, solicitante, responsável,
 *    `SlaMeter` ao vivo e datas relevantes (criação, atualização, prazo
 *    de SLA, resolução e fechamento quando presentes). É a fonte
 *    canônica de "o que é este ticket".
 * 3. **Coluna direita — Conversa + Histórico**: a conversa é o
 *    `<TicketConversation />` real (mensagens escopadas por papel +
 *    composer com toggle de nota interna para tecnico/admin) e o
 *    histórico é o `<TicketHistory />` cronológico de
 *    `ticket_events` (R12.2, R16.9).
 *
 * Notas de implementação:
 *
 * - Defesa em profundidade sobre o middleware: `auth()` + `redirect`
 *   garantem que nenhuma renderização ocorra sem `session.user`,
 *   mesmo se a rota for excluída do `matcher` por engano (R1.1, R1.7).
 * - Carregamentos auxiliares (`policies`, `categories`, `departments`,
 *   `requester`, `assignee`, `messages`, `events`) rodam em
 *   `Promise.all` para reduzir TTFB — nenhum depende do outro depois
 *   que o ticket está em mãos.
 * - O `params` chega como `Promise` em Next 15; `await params` é
 *   obrigatório antes de qualquer uso (mesmo padrão de
 *   `(app)/tickets/page.tsx`).
 * - Componente puro RSC — sem `"use client"`, sem hooks. O `SlaMeter`
 *   é um Client Component que se renderiza dentro do RSC sem extra
 *   trabalho.
 *
 * Validates: R12.1, R12.2, R12.7, R16.9
 */

import { notFound, redirect } from "next/navigation";

import { db } from "@/db/client";
import { listEventsForTicket } from "@/db/repositories/events.repo";
import { findVisibleForUser } from "@/db/repositories/tickets.repo";
import {
    findById as findUserById,
    findByIds as findUsersByIds,
    listAssignable,
} from "@/db/repositories/users.repo";
import { CategoryChip } from "@/components/domain/category-chip";
import { PriorityPill } from "@/components/domain/priority-pill";
import { SlaMeter } from "@/components/domain/sla-meter";
import { StatusBadge } from "@/components/domain/status-badge";
import { Avatar } from "@/components/ui/avatar";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { auth } from "@/lib/auth";
import { fmtDateTime, relTime } from "@/lib/format";
import {
    canAssignOthers,
    canAssignSelf,
    canChangePriority,
    canChangeStatus,
    canPostInternalNote,
    canRateTicket,
} from "@/lib/policies";
import { getValidTransitions } from "@/lib/ticket-state";
import {
    getAllSlaPolicies,
    listCategories,
    listDepartments,
} from "@/services/reads.service";
import { listMessagesForUser } from "@/services/messages.service";
import { autoCloseIfExpired } from "@/services/tickets.service";
import type { SessionUser, TicketStatus } from "@/types/domain";

import {
    TicketConversation,
    type ConversationAuthor,
    type ConversationMessage,
} from "./ticket-conversation";
import { TicketControls, type AssignableUser } from "./ticket-controls";
import { TicketHistory } from "./ticket-history";

/** Em Next 15 `params` é uma Promise — precisa ser `await`-ado. */
interface TicketDetailPageProps {
    params: Promise<{ id: string }>;
}

/**
 * Linha de "rótulo + valor" usada na tabela de detalhes.
 *
 * Mantida local porque a forma é altamente específica desta página: um
 * `dl` minimalista com `dt` em coluna estreita à esquerda e `dd` em
 * coluna fluida à direita. Permite passar elementos JSX (badges,
 * avatares) ou texto simples como `value`.
 */
function DetailRow({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-start gap-4">
            <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-(--ink-3)">
                {label}
            </dt>
            <dd className="min-w-0 flex-1 text-sm text-(--ink)">{children}</dd>
        </div>
    );
}

/**
 * Bloco compacto que exibe o avatar de um usuário ao lado do nome.
 * Reutiliza o primitivo `Avatar`, que aceita uma cor de fundo
 * hexadecimal vinda do `users.avatar_color` para que cada pessoa tenha
 * uma identidade visual estável em toda a aplicação. Quando o usuário
 * tem foto (`avatarUrl`), ela é exibida; caso contrário cai no
 * fallback de iniciais sobre a cor.
 */
function UserBadge({
    name,
    avatarColor,
    avatarUrl,
}: {
    name: string;
    avatarColor?: string;
    avatarUrl?: string | null;
}) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <Avatar
                name={name}
                color={avatarColor}
                {...(avatarUrl ? { src: avatarUrl } : {})}
                size="sm"
            />
            <span className="min-w-0 truncate text-(--ink)" title={name}>
                {name}
            </span>
        </span>
    );
}

export default async function TicketDetailPage({
    params,
}: TicketDetailPageProps) {
    // Defesa em profundidade — middleware já bloqueia anônimos, mas o
    // redirect explícito garante que nenhum bloco abaixo execute sem
    // `session.user` populado (R1.1, R1.7).
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const user = session.user satisfies SessionUser;

    const { id: rawId } = await params;
    // O ID legível pode chegar percent-encoded (improvável dado o formato
    // `NVD-XXXX`, mas o decode mantém a robustez frente a clientes
    // quaisquer); em caso de string vazia, segue para `notFound`.
    const ticketId = decodeURIComponent(rawId);
    if (ticketId.length === 0) {
        notFound();
    }

    // 1) Carrega o ticket aplicando o filtro RBAC no SQL (R12.7). `null`
    //    representa simultaneamente "não existe" e "existe mas o
    //    solicitante não pode ver" — `notFound()` em ambos os casos.
    const loaded = await findVisibleForUser(db, user, ticketId);
    if (!loaded) {
        notFound();
    }

    // Auto-fechamento "preguiçoso": tickets em `resolvido` há mais de
    // 24h são fechados na primeira vez que alguém abre a página depois
    // do prazo (R12.6). A função é idempotente — ticket já fechado ou
    // dentro da janela passa direto. Atribui o evento ao próprio
    // solicitante que abriu a página, mantendo a trilha de auditoria
    // coerente com a UI ("você deixou passar a janela e o sistema
    // fechou para você").
    const ticket = await autoCloseIfExpired(loaded, user);

    // 2) Carregamentos auxiliares em paralelo: políticas (para o
    //    SlaMeter), taxonomias (para resolver labels e ícones),
    //    metadados de solicitante/responsável e a conversa do ticket
    //    (já filtrada por papel — solicitantes nunca recebem notas
    //    internas, R7.4). Nenhum desses blocos depende do outro.
    //
    //    `assignableUsers` carrega técnicos/admins ativos quando o
    //    `actor` pode designar terceiros; para os demais papéis
    //    devolvemos `[]` sem tocar o banco para manter o RSC enxuto
    //    (o repository ignora chamadas extras, mas evitar I/O é mais
    //    barato e mais explícito sobre intent).
    const canAssignToOthers = canAssignOthers(user);
    const [policies, categories, departments, requester, assignee, messages, events, assignableUsersRaw] =
        await Promise.all([
            getAllSlaPolicies(),
            listCategories(),
            listDepartments(),
            findUserById(db, ticket.requesterId),
            ticket.assigneeId
                ? findUserById(db, ticket.assigneeId)
                : Promise.resolve(null),
            listMessagesForUser(user, ticket.id),
            listEventsForTicket(db, ticket.id),
            canAssignToOthers
                ? listAssignable(db)
                : Promise.resolve([] as Awaited<ReturnType<typeof listAssignable>>),
        ]);

    const category = categories.find((c) => c.id === ticket.categoryId);
    const department = departments.find((d) => d.id === ticket.departmentId);

    // Fallbacks defensivos — referências quebradas (categoria removida,
    // departamento sem nome) caem em strings legíveis em vez de crashar
    // a página. Cenário improvável dado FK no schema, mas barato manter.
    const categoryIcon = category?.icon ?? "tag";
    const categoryLabel = category?.label ?? ticket.categoryId;
    const categorySub = category?.sub;
    const departmentName = department?.name ?? "—";
    const requesterName = requester?.name ?? "—";
    const assigneeName = assignee?.name ?? null;

    const headerDescription = requester
        ? `Aberto por ${requester.name} · ${relTime(ticket.createdAt)}`
        : `Aberto ${relTime(ticket.createdAt)}`;

    // 3) Resolve autores das mensagens e atores dos eventos em uma
    //    única consulta `inArray(users.id, ...)` (evita N+1). O
    //    conjunto inclui o solicitante e o responsável já carregados
    //    acima — ambos podem aparecer como autores na conversa ou
    //    como atores no histórico, e mantê-los no mapa evita fetch
    //    redundante. Em seguida monta o objeto `authorsById` com
    //    apenas os campos consumidos pelo Client Component
    //    (conversa) e o mapa simplificado `actorNamesById` para o
    //    histórico (que só precisa do nome).
    const knownIds = new Set<string>();
    if (requester) knownIds.add(requester.id);
    if (assignee) knownIds.add(assignee.id);

    const peopleIds = Array.from(
        new Set([
            ...messages.map((m) => m.authorId),
            ...events.map((e) => e.actorId),
        ]),
    ).filter((id) => !knownIds.has(id));

    const extraPeople = await findUsersByIds(db, peopleIds);

    const authorsById: Record<string, ConversationAuthor> = {};
    const actorNamesById: Record<string, string> = {};
    for (const u of extraPeople) {
        authorsById[u.id] = {
            id: u.id,
            name: u.name,
            avatarColor: u.avatarColor,
            avatarUrl: u.avatarUrl,
        };
        actorNamesById[u.id] = u.name;
    }
    if (requester) {
        authorsById[requester.id] = {
            id: requester.id,
            name: requester.name,
            avatarColor: requester.avatarColor,
            avatarUrl: requester.avatarUrl,
        };
        actorNamesById[requester.id] = requester.name;
    }
    if (assignee) {
        authorsById[assignee.id] = {
            id: assignee.id,
            name: assignee.name,
            avatarColor: assignee.avatarColor,
            avatarUrl: assignee.avatarUrl,
        };
        actorNamesById[assignee.id] = assignee.name;
    }

    // Mapeia para o shape minimalista esperado pelo Client Component.
    const conversationMessages: ConversationMessage[] = messages.map((m) => ({
        id: m.id,
        body: m.body,
        isInternal: m.isInternal,
        authorId: m.authorId,
        createdAt: m.createdAt,
    }));

    const canPostInternal = canPostInternalNote(user);

    // Policies pré-computadas no servidor (mantém o Client Component
    // longe de `lib/policies` e centraliza a decisão num único lugar).
    // O conjunto de `allowedNextStatuses` cruza a tabela da máquina de
    // estados (`getValidTransitions`) com o RBAC (`canChangeStatus`):
    // admins/técnicos responsáveis recebem todos os destinos válidos,
    // solicitantes recebem só `resolvido → fechado` quando aplicável
    // (R12.4).
    const canChangePriorityFlag = canChangePriority(user, ticket);
    const canAssignSelfFlag = canAssignSelf(user, ticket);
    const canRateTicketFlag = canRateTicket(user, ticket);

    const allowedNextStatuses: TicketStatus[] = getValidTransitions(
        ticket.status,
    ).filter((s) => canChangeStatus(user, ticket, s));

    // Mapa enxuto para o Client Component (apenas o necessário —
    // `id` e `name`).
    const assignableUsers: AssignableUser[] = assignableUsersRaw.map((u) => ({
        id: u.id,
        name: u.name,
    }));

    // Mensagens travam quando o ticket sai dos estados ativos.
    // Solicitantes deixam de ver o composer; técnicos/admins continuam
    // podendo postar notas internas (o componente força `isInternal=true`).
    //
    // A mensagem para "resolvido" é diferente conforme o papel:
    // - Solicitante recebe o aviso das 24h (R12.5/R12.6 + auto-close).
    // - Técnico/admin recebe o aviso operacional (composer força nota
    //   interna).
    const isRequester = user.role === "solicitante";
    const lockedMessage =
        ticket.status === "fechado"
            ? "Este ticket está fechado. Não é possível adicionar novas mensagens."
            : ticket.status === "resolvido"
                ? isRequester
                    ? "Este ticket foi marcado como resolvido. Avalie o atendimento e confirme o fechamento. Se você não confirmar em até 24h, ele será fechado automaticamente."
                    : "Ticket aguardando confirmação do solicitante. Apenas notas internas podem ser adicionadas."
                : undefined;

    return (
        <div className="flex flex-col gap-6">
            {/* Cabeçalho — título + meta + badges no mesmo bloco para
                economizar espaço vertical e dar o "cartão de visita" do
                ticket logo no topo (R12.1). */}
            <header className="flex flex-col gap-3">
                <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-(--ink-3)">
                        {ticket.id}
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold leading-tight text-(--ink)">
                        {ticket.title}
                    </h1>
                    <p className="mt-1 text-sm text-(--ink-3)">
                        {headerDescription}
                    </p>
                </div>
                <div
                    className="flex flex-wrap items-center gap-2"
                    aria-label="Resumo do ticket"
                >
                    <StatusBadge status={ticket.status} />
                    <PriorityPill priority={ticket.priority} />
                    <CategoryChip
                        icon={categoryIcon}
                        label={categoryLabel}
                        {...(categorySub ? { sub: categorySub } : {})}
                    />
                    {ticket.status !== "resolvido" &&
                        ticket.status !== "fechado" ? (
                        <SlaMeter
                            deadline={ticket.slaDeadline}
                            priority={ticket.priority}
                            status={ticket.status}
                            policies={policies}
                        />
                    ) : null}
                </div>
            </header>

            {/* Descrição original — primeiro contato do solicitante.
                Mantida em destaque, separada da conversa, para que o
                técnico nunca precise rolar atrás do contexto inicial. */}
            {ticket.description.trim().length > 0 ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Descrição</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <p className="whitespace-pre-wrap break-words text-sm text-(--ink-2)">
                            {ticket.description}
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {/* Layout principal — sidebar esquerda fixa (sticky em telas
                grandes) com Detalhes + Ações; coluna direita ocupa o
                restante com Conversa/Histórico em tabs. As duas colunas
                têm altura equivalente porque o card direito controla a
                altura via tab content de altura fixa. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
                {/* Coluna esquerda — sticky em desktop para acompanhar
                    o scroll da página. Mantém Detalhes e Ações sempre
                    visíveis enquanto o operador navega na conversa. */}
                <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                                Detalhes
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <dl className="flex flex-col gap-3 text-sm">
                                <DetailRow label="Departamento">
                                    <span className="text-(--ink-2)">
                                        {departmentName}
                                    </span>
                                </DetailRow>
                                <DetailRow label="Solicitante">
                                    {requester ? (
                                        <UserBadge
                                            name={requesterName}
                                            avatarColor={requester.avatarColor}
                                            avatarUrl={requester.avatarUrl}
                                        />
                                    ) : (
                                        <span className="text-(--ink-4)">
                                            —
                                        </span>
                                    )}
                                </DetailRow>
                                <DetailRow label="Atribuído">
                                    {assignee && assigneeName ? (
                                        <UserBadge
                                            name={assigneeName}
                                            avatarColor={assignee.avatarColor}
                                            avatarUrl={assignee.avatarUrl}
                                        />
                                    ) : (
                                        <span className="text-(--ink-4)">
                                            Sem responsável
                                        </span>
                                    )}
                                </DetailRow>
                                <DetailRow label="Aberto em">
                                    <span className="text-(--ink-2)">
                                        {fmtDateTime(ticket.createdAt)}
                                    </span>
                                </DetailRow>
                                <DetailRow label="Atualizado">
                                    <span className="text-(--ink-2)">
                                        {relTime(ticket.updatedAt)}
                                    </span>
                                </DetailRow>
                                <DetailRow label="Prazo do SLA">
                                    <span className="tabular-nums text-(--ink-2)">
                                        {fmtDateTime(ticket.slaDeadline)}
                                    </span>
                                </DetailRow>
                                {ticket.resolvedAt ? (
                                    <DetailRow label="Resolvido em">
                                        <span className="text-(--ink-2)">
                                            {fmtDateTime(ticket.resolvedAt)}
                                        </span>
                                    </DetailRow>
                                ) : null}
                                {ticket.closedAt ? (
                                    <DetailRow label="Fechado em">
                                        <span className="text-(--ink-2)">
                                            {fmtDateTime(ticket.closedAt)}
                                        </span>
                                    </DetailRow>
                                ) : null}
                            </dl>
                        </CardContent>
                    </Card>

                    {/* Painel de ações — sub-seções condicionais ao
                        papel do `actor` (status, prioridade, atribuição,
                        avaliação). Renderiza `null` se nenhuma ação
                        está disponível, evitando um card "Ações" vazio
                        (R2.7). */}
                    <TicketControls
                        ticket={ticket}
                        currentUser={user}
                        assignableUsers={assignableUsers}
                        allowedNextStatuses={allowedNextStatuses}
                        canChangePriorityFlag={canChangePriorityFlag}
                        canAssignSelfFlag={canAssignSelfFlag}
                        canAssignOthersFlag={canAssignToOthers}
                        canRateTicketFlag={canRateTicketFlag}
                    />
                </aside>

                {/* Coluna direita — Conversa / Histórico em tabs. O
                    `Card` controla o cabeçalho e a borda; cada tab
                    interna gerencia o próprio scroll. Com isso o
                    histórico não estica mais o layout e a conversa
                    mantém composer fixo abaixo da lista. */}
                <Card>
                    <Tabs defaultValue="conversa">
                        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
                            <TabsList>
                                <TabsTrigger value="conversa">
                                    Conversa
                                    {messages.length > 0 ? (
                                        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-(--r-pill) bg-(--bg-sunk) px-1.5 text-[11px] font-medium tabular-nums text-(--ink-2)">
                                            {messages.length}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                                <TabsTrigger value="historico">
                                    Histórico
                                    {events.length > 0 ? (
                                        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-(--r-pill) bg-(--bg-sunk) px-1.5 text-[11px] font-medium tabular-nums text-(--ink-2)">
                                            {events.length}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                            </TabsList>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <TabsContent value="conversa" className="pt-2">
                                <TicketConversation
                                    bare
                                    ticketId={ticket.id}
                                    messages={conversationMessages}
                                    authorsById={authorsById}
                                    currentUser={user}
                                    canPostInternal={canPostInternal}
                                    {...(lockedMessage
                                        ? { lockedMessage }
                                        : {})}
                                />
                            </TabsContent>
                            <TabsContent value="historico" className="pt-2">
                                <TicketHistory
                                    bare
                                    events={events}
                                    actorNamesById={actorNamesById}
                                />
                            </TabsContent>
                        </CardContent>
                    </Tabs>
                </Card>
            </div>
        </div>
    );
}
