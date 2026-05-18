/**
 * `TicketControls` — Client Component que reúne, em um único `Card`
 * lateral, todas as ações interativas do detalhe do ticket
 * (`/tickets/[id]`):
 *
 * - **Status**: dropdown com os destinos válidos para o status atual
 *   (consultando `getValidTransitions`). Solicitantes recebem apenas
 *   a transição `resolvido → fechado` (R12.4); técnicos/admins
 *   recebem a lista completa filtrada por `canChangeStatus`.
 * - **Prioridade**: dropdown que muda a prioridade do ticket
 *   (R12.3). Apenas admin ou o técnico responsável veem a seção
 *   (`canChangePriority`).
 * - **Atribuição**:
 *     - Botão **Assumir** quando `canAssignSelf` e o usuário ainda
 *       não é o responsável (R5.1).
 *     - `Select` **Atribuir a outro** com a lista de técnicos e
 *       admins ativos (apenas admin via `canAssignOthers`, R5.3).
 *     - Botão **Remover atribuição** quando o ticket tem assignee
 *       e `canAssignOthers` (R5.5).
 * - **Avaliação**: 1..5 estrelas para o solicitante autor confirmar
 *   a satisfação após resolução (R12.5, R12.6). Renderiza apenas
 *   quando `canRateTicket(actor, ticket)`.
 *
 * O componente recebe os predicados pré-computados do Server
 * Component pai (`canChangeStatusFlag`, `canChangePriorityFlag`,
 * etc.) — manter as policies puras avaliadas no servidor evita
 * importar `lib/policies.ts` em código `"use client"` e mantém a
 * decisão visível em um único lugar (R2.7). O Client Component
 * apenas decide se mostra cada sub-seção.
 *
 * Cada submit roda dentro de `useTransition` para que o controle
 * mostre estado `loading` enquanto a Server Action está em voo.
 * Em sucesso, dispara um toast `success`; em erro, dispara um toast
 * `error` com a mensagem do servidor. Toda ação confia no
 * `revalidatePath` já presente nas Server Actions (R12.8): o
 * componente não tenta modificar estado local do ticket — uma vez
 * revalidada, a página re-renderiza com os valores canônicos.
 *
 * Visual:
 *
 * - O `Card` tem o título "Ações". Sub-seções recebem subtítulos em
 *   `--ink-3` para hierarquia leve. Quando uma sub-seção não se
 *   aplica ao usuário, ela simplesmente não é renderizada — nunca
 *   exibimos uma seção vazia. Se nenhuma sub-seção estiver disponível,
 *   o card inteiro deixa de ser renderizado pelo pai.
 *
 * Validates: R5, R12.3, R12.4, R12.5, R12.6, R12.8.
 */

"use client";

import * as React from "react";

import { CheckCircle2, Star } from "lucide-react";

import {
    assignTicketAction,
    assignTicketToMeAction,
    changeTicketPriorityAction,
    changeTicketStatusAction,
    rateTicketAction,
    unassignTicketAction,
} from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/error-messages";
import {
    PRIORITIES,
    PRIORITY_LABELS_PT,
    STATUS_LABELS_PT,
} from "@/lib/constants";
import type {
    Priority,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

/** Sentinela usada no `Select` de atribuição para indicar "sem responsável". */
const UNASSIGNED_VALUE = "__unassigned__";

/**
 * Resumo mínimo de um usuário usado nos selects de atribuição. O Server
 * Component materializa o array a partir de `users.repo.listAssignable`
 * — apenas técnicos e admins ativos (R5.3) — antes de passar adiante.
 */
export interface AssignableUser {
    id: string;
    name: string;
}

export interface TicketControlsProps {
    /** Ticket atual já visível pelo `actor` (R12.7). */
    ticket: Ticket;
    /** Usuário autenticado — fonte de identidade para auto-atribuição. */
    currentUser: SessionUser;
    /**
     * Lista de candidatos a responsável (técnicos + admins ativos).
     * Vazia quando o `actor` não tem permissão de designar terceiros
     * (Server Component pode passar `[]` para economizar a query).
     */
    assignableUsers: readonly AssignableUser[];
    /**
     * Status válidos para mudar via dropdown — tipicamente
     * `getValidTransitions(ticket.status)` já filtrado pelo
     * `canChangeStatus` para o `actor`.
     */
    allowedNextStatuses: readonly TicketStatus[];
    /** `true` quando o `actor` pode editar prioridade (`canChangePriority`). */
    canChangePriorityFlag: boolean;
    /** `true` quando o `actor` pode se auto-atribuir (`canAssignSelf`). */
    canAssignSelfFlag: boolean;
    /** `true` quando o `actor` pode designar outros (`canAssignOthers`). */
    canAssignOthersFlag: boolean;
    /** `true` quando o `actor` pode avaliar o ticket (`canRateTicket`). */
    canRateTicketFlag: boolean;
}

/**
 * Sub-seção do painel — título compacto + corpo. Centraliza o estilo do
 * "subtítulo" (xs uppercase em `--ink-3`) para que todas as seções
 * fiquem alinhadas visualmente.
 */
function ControlSection({
    title,
    children,
    className,
}: {
    title: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("flex flex-col gap-2", className)}>
            <h4 className="text-xs uppercase tracking-wide text-(--ink-3)">
                {title}
            </h4>
            {children}
        </section>
    );
}

/**
 * Componente compacto de avaliação por estrelas.
 *
 * Mantemos a implementação local porque é o único ponto da UI que precisa
 * de estrelas; promover a um primitivo só faz sentido se outra
 * superfície adotar o mesmo controle. Acessibilidade: cada estrela é
 * um `<button>` com `aria-label` legível ("Avaliar com 1 estrela", …)
 * e o grupo é envolto em `role="radiogroup"` para que leitores de
 * tela anunciem o conjunto.
 */
function StarRating({
    value,
    onChange,
    disabled,
}: {
    value: 1 | 2 | 3 | 4 | 5 | null;
    onChange: (next: 1 | 2 | 3 | 4 | 5) => void;
    disabled?: boolean;
}) {
    const [hover, setHover] = React.useState<number | null>(null);
    const active = hover ?? value ?? 0;

    return (
        <div
            role="radiogroup"
            aria-label="Avaliação"
            className="inline-flex items-center gap-1"
        >
            {[1, 2, 3, 4, 5].map((n) => {
                const filled = n <= active;
                return (
                    <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={value === n}
                        aria-label={`Avaliar com ${n} ${n === 1 ? "estrela" : "estrelas"}`}
                        disabled={disabled}
                        onMouseEnter={() => setHover(n)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(n)}
                        onBlur={() => setHover(null)}
                        onClick={() => onChange(n as 1 | 2 | 3 | 4 | 5)}
                        className={cn(
                            "rounded-(--r-2) p-1 outline-none transition-colors",
                            "focus-visible:ring-2 focus-visible:ring-(--accent)",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            filled
                                ? "text-(--amber)"
                                : "text-(--ink-4) hover:text-(--amber)",
                        )}
                    >
                        <Star
                            className="size-5"
                            aria-hidden="true"
                            fill={filled ? "currentColor" : "none"}
                            strokeWidth={1.75}
                        />
                    </button>
                );
            })}
        </div>
    );
}

export function TicketControls({
    ticket,
    currentUser,
    assignableUsers,
    allowedNextStatuses,
    canChangePriorityFlag,
    canAssignSelfFlag,
    canAssignOthersFlag,
    canRateTicketFlag,
}: TicketControlsProps): React.ReactElement | null {
    const [isStatusPending, startStatusTransition] = React.useTransition();
    const [isPriorityPending, startPriorityTransition] = React.useTransition();
    const [isAssignPending, startAssignTransition] = React.useTransition();
    const [isRatingPending, startRatingTransition] = React.useTransition();

    // Renderização do bloco de status: só faz sentido se há ao menos um
    // destino válido. Solicitantes recebem um fluxo dedicado (botão
    // "Confirmar fechamento" que aparece após avaliar) — esconder o
    // dropdown genérico para o papel evita confusão (R12.4, R12.5).
    const isRequester = currentUser.role === "solicitante";
    const showStatus = !isRequester && allowedNextStatuses.length > 0;
    const showPriority = canChangePriorityFlag;
    const isOwnAssignee = ticket.assigneeId === currentUser.id;
    const showAssumeButton = canAssignSelfFlag && !isOwnAssignee;
    const showAssignSelect = canAssignOthersFlag && assignableUsers.length > 0;
    const showUnassignButton =
        canAssignOthersFlag && ticket.assigneeId !== null;
    const showAssignmentSection =
        showAssumeButton || showAssignSelect || showUnassignButton;
    const showRating = canRateTicketFlag;

    // Confirmação do solicitante (`resolvido → fechado`).
    //
    // Aparece **somente após** ele avaliar o atendimento (R12.5, R12.6):
    //   1. avaliar primeiro (incentivo para que o feedback seja
    //      capturado mesmo quando o usuário só quer "fechar e seguir
    //      em frente");
    //   2. confirmar fechamento depois.
    //
    // O destino "fechado" sempre aparece em `allowedNextStatuses` para
    // solicitantes em tickets resolvidos (cruzamento de máquina de
    // estados + `canChangeStatus`); usamos esse fato como guarda em
    // vez de re-derivar a regra aqui.
    const allowsCloseTransition = (
        allowedNextStatuses as readonly TicketStatus[]
    ).includes("fechado");
    const hasRated = ticket.rating !== null;
    const showRequesterConfirm =
        isRequester && allowsCloseTransition && hasRated;

    // Esconde o card quando o ator não tem nenhuma ação disponível —
    // evita renderizar um "Ações" vazio (R2.7).
    const hasAnySection =
        showStatus ||
        showPriority ||
        showAssignmentSection ||
        showRating ||
        showRequesterConfirm;
    if (!hasAnySection) return null;

    function handleStatusChange(next: string): void {
        const target = next as TicketStatus;
        if (target === ticket.status) return;
        startStatusTransition(async () => {
            const result = await changeTicketStatusAction(ticket.id, target);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Status atualizado",
                    description: `Ticket marcado como ${STATUS_LABELS_PT[target].toLowerCase()}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível atualizar o status",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    function handlePriorityChange(next: string): void {
        const target = next as Priority;
        if (target === ticket.priority) return;
        startPriorityTransition(async () => {
            const result = await changeTicketPriorityAction(ticket.id, target);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Prioridade atualizada",
                    description: `Definida como ${PRIORITY_LABELS_PT[target]}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível atualizar a prioridade",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    function handleAssumeClick(): void {
        startAssignTransition(async () => {
            const result = await assignTicketToMeAction(ticket.id);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Ticket atribuído a você",
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível assumir o ticket",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    function handleAssignSelect(next: string): void {
        // Sentinela "sem responsável" → fluxo de remoção administrativa.
        if (next === UNASSIGNED_VALUE) {
            handleUnassignClick();
            return;
        }
        if (next === ticket.assigneeId) return;
        startAssignTransition(async () => {
            const result = await assignTicketAction(ticket.id, next);
            if (result.ok) {
                const targetName =
                    assignableUsers.find((u) => u.id === next)?.name ??
                    "responsável";
                toast({
                    variant: "success",
                    title: "Ticket atribuído",
                    description: `Responsável agora é ${targetName}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível atribuir o ticket",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    function handleUnassignClick(): void {
        startAssignTransition(async () => {
            const result = await unassignTicketAction(ticket.id);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Atribuição removida",
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível remover a atribuição",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    function handleRate(stars: 1 | 2 | 3 | 4 | 5): void {
        if (ticket.rating === stars) return;
        startRatingTransition(async () => {
            const result = await rateTicketAction(ticket.id, stars);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Avaliação registrada",
                    description: `Você avaliou em ${stars} ${stars === 1 ? "estrela" : "estrelas"}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível registrar a avaliação",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    /**
     * Confirma o fechamento do ticket pelo solicitante. Reusa
     * `changeTicketStatusAction` em vez de criar uma action dedicada:
     * a transição `resolvido → fechado` para solicitantes já é a única
     * liberada pela máquina de estados + RBAC (R12.4), então a regra
     * "confirmar fechamento" mapeia 1:1 para "mudar status para
     * fechado". O nome do botão na UI esclarece a intenção.
     */
    function handleConfirmClose(): void {
        startStatusTransition(async () => {
            const result = await changeTicketStatusAction(
                ticket.id,
                "fechado",
            );
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Ticket fechado",
                    description: "Obrigado pela confirmação!",
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível fechar o ticket",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    // Valor exibido no `Select` de atribuição: usa o `assigneeId` quando
    // está na lista de candidatos; caso contrário cai na sentinela de
    // "sem responsável" para o trigger renderizar com o placeholder.
    const assigneeSelectValue =
        ticket.assigneeId &&
            assignableUsers.some((u) => u.id === ticket.assigneeId)
            ? ticket.assigneeId
            : UNASSIGNED_VALUE;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Ações</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-5">
                    {showAssignmentSection ? (
                        <ControlSection title="Atribuição">
                            {showAssumeButton ? (
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleAssumeClick}
                                    loading={isAssignPending}
                                    disabled={isAssignPending}
                                >
                                    Assumir ticket
                                </Button>
                            ) : null}

                            {showAssignSelect ? (
                                <Select
                                    value={assigneeSelectValue}
                                    onValueChange={handleAssignSelect}
                                    disabled={isAssignPending}
                                >
                                    <SelectTrigger
                                        aria-label="Atribuir a outro usuário"
                                    >
                                        <SelectValue placeholder="Selecionar responsável…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={UNASSIGNED_VALUE}>
                                            Sem responsável
                                        </SelectItem>
                                        {assignableUsers.map((u) => (
                                            <SelectItem key={u.id} value={u.id}>
                                                {u.name}
                                                {u.id === currentUser.id
                                                    ? " (você)"
                                                    : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : null}

                            {/* Botão dedicado de "Remover atribuição" para
                                admins quando o select não está disponível
                                (lista vazia), garantindo que a ação não fique
                                inacessível. */}
                            {showUnassignButton && !showAssignSelect ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleUnassignClick}
                                    loading={isAssignPending}
                                    disabled={isAssignPending}
                                >
                                    Remover atribuição
                                </Button>
                            ) : null}
                        </ControlSection>
                    ) : null}

                    {showStatus ? (
                        <ControlSection title="Status">
                            <Select
                                value={ticket.status}
                                onValueChange={handleStatusChange}
                                disabled={isStatusPending}
                            >
                                <SelectTrigger
                                    aria-label="Alterar status do ticket"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* Status atual sempre presente como opção
                                        (no-op idempotente) para que o trigger
                                        consiga refletir o estado corrente. */}
                                    <SelectItem value={ticket.status}>
                                        {STATUS_LABELS_PT[ticket.status]}
                                    </SelectItem>
                                    {allowedNextStatuses.map((s) => (
                                        <SelectItem key={s} value={s}>
                                            {STATUS_LABELS_PT[s]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* Aviso de auto-atribuição: técnico sem
                                responsável vai assumir junto com a mudança
                                de status. Mantém o usuário ciente do efeito
                                colateral antes do clique. */}
                            {currentUser.role === "tecnico" &&
                                ticket.assigneeId === null ? (
                                <p className="text-xs text-(--ink-3)">
                                    Ao alterar o status, o ticket será atribuído a você.
                                </p>
                            ) : null}
                        </ControlSection>
                    ) : null}

                    {showPriority ? (
                        <ControlSection title="Prioridade">
                            <Select
                                value={ticket.priority}
                                onValueChange={handlePriorityChange}
                                disabled={isPriorityPending}
                            >
                                <SelectTrigger
                                    aria-label="Alterar prioridade do ticket"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PRIORITIES.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {PRIORITY_LABELS_PT[p]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </ControlSection>
                    ) : null}

                    {showRating ? (
                        <ControlSection title="Avaliação">
                            <div className="flex flex-wrap items-center gap-3">
                                <StarRating
                                    value={ticket.rating}
                                    onChange={handleRate}
                                    disabled={isRatingPending}
                                />
                                {ticket.rating !== null ? (
                                    <span className="text-sm text-(--ink-3)">
                                        Avaliado em {ticket.rating}/5
                                    </span>
                                ) : (
                                    <span className="text-sm text-(--ink-4)">
                                        Avalie para liberar o fechamento
                                    </span>
                                )}
                            </div>
                        </ControlSection>
                    ) : null}

                    {showRequesterConfirm ? (
                        <ControlSection title="Confirmar fechamento">
                            <p className="text-sm text-(--ink-2)">
                                Tudo certo? Confirme para encerrar este
                                ticket.
                            </p>
                            <p className="text-xs text-(--ink-3)">
                                Se você não confirmar em até 24h, o ticket
                                será fechado automaticamente.
                            </p>
                            <Button
                                type="button"
                                variant="primary"
                                icon={<CheckCircle2 />}
                                loading={isStatusPending}
                                disabled={isStatusPending}
                                onClick={handleConfirmClose}
                            >
                                Confirmar fechamento
                            </Button>
                        </ControlSection>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}
