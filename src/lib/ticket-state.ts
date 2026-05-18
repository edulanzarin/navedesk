/**
 * Máquina de estados pura de tickets.
 *
 * Encapsula a tabela de transições do design (Algoritmos → Função 3) em uma
 * função pura, total e determinística sobre o produto cartesiano de
 * `TicketStatus × TicketAction`. A máquina não conhece banco, RBAC ou
 * relógio — quem orquestra é o serviço de tickets, que combina policies +
 * `transitionTicketStatus` + persistência em uma única transação.
 *
 * Tabela de transições:
 *
 * | Estado atual | ASSIGN     | WAIT_REQUESTER | RESPOND     | RESOLVE     | REOPEN  | CLOSE     |
 * | ------------ | ---------- | -------------- | ----------- | ----------- | ------- | --------- |
 * | aberto       | andamento  | aguardando     | aberto      | resolvido   | —       | fechado   |
 * | andamento    | andamento  | aguardando     | andamento   | resolvido   | —       | fechado   |
 * | aguardando   | aguardando | aguardando     | andamento   | resolvido   | —       | fechado   |
 * | resolvido    | —          | —              | andamento   | resolvido   | aberto  | fechado   |
 * | fechado      | —          | —              | —           | —           | aberto  | fechado   |
 *
 * Validates: R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8, R4.9
 */

import type { TicketAction, TicketStatus } from "@/types/domain";

/**
 * Erro lançado quando uma transição não é aceita pela máquina de estados.
 *
 * Carrega o `current` (estado de origem) e a `action` solicitada para
 * permitir mensagens precisas e telemetria. O campo `action` é `null`
 * quando o erro vem de `deriveAction` e nenhum mapeamento canônico existe
 * entre os dois estados — útil para distinguir transições inválidas
 * iniciadas por status (`current → next` sem ação inferível) de
 * transições inválidas iniciadas por ação (`current + action`).
 */
export class IllegalStateTransitionError extends Error {
    constructor(
        public readonly current: TicketStatus,
        public readonly action: TicketAction | null,
        public readonly attemptedNext?: TicketStatus,
    ) {
        const detail =
            action !== null
                ? `${action} from ${current}`
                : `${current} → ${attemptedNext ?? "?"} (no action derivable)`;
        super(`Illegal transition: ${detail}`);
        this.name = "IllegalStateTransitionError";
    }
}

/**
 * Tabela de transições aceitas. Estados ausentes em uma linha representam
 * transições proibidas (marcadas como `—` na tabela do design) e levam ao
 * lançamento de `IllegalStateTransitionError`.
 *
 * `Readonly` no nível da tabela e dos sub-mapas garante que nenhum
 * consumidor mute o comportamento da máquina em runtime.
 */
const TRANSITIONS: Readonly<
    Record<TicketStatus, Readonly<Partial<Record<TicketAction, TicketStatus>>>>
> = {
    aberto: {
        ASSIGN: "andamento",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "aberto",
        RESOLVE: "resolvido",
        CLOSE: "fechado",
    },
    andamento: {
        ASSIGN: "andamento",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        CLOSE: "fechado",
    },
    aguardando: {
        ASSIGN: "aguardando",
        WAIT_REQUESTER: "aguardando",
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        CLOSE: "fechado",
    },
    resolvido: {
        RESPOND: "andamento",
        RESOLVE: "resolvido",
        REOPEN: "aberto",
        CLOSE: "fechado",
    },
    fechado: {
        REOPEN: "aberto",
        CLOSE: "fechado",
    },
};

/**
 * Calcula o próximo status de um ticket dado o status atual e a ação.
 *
 * Pré-condições:
 * - `current ∈ TicketStatus`.
 * - `action ∈ TicketAction`.
 *
 * Pós-condições:
 * - Retorna o próximo `TicketStatus` conforme a tabela acima.
 * - Lança `IllegalStateTransitionError(current, action)` para combinações
 *   marcadas com `—`.
 *
 * Propriedades:
 * - **Pura**: sem efeitos colaterais.
 * - **Determinística**: mesma entrada produz mesma saída.
 * - **Total** sobre o domínio aceito; **idempotente** quando
 *   `next === current` (ex.: `RESOLVE` em `resolvido`).
 */
export function transitionTicketStatus(
    current: TicketStatus,
    action: TicketAction,
): TicketStatus {
    const next = TRANSITIONS[current][action];
    if (next === undefined) {
        throw new IllegalStateTransitionError(current, action);
    }
    return next;
}

/**
 * Inferência da ação canônica que leva `current` ao status `next`.
 *
 * Usado pela borda (Server Actions/serviços) quando a UI envia o
 * `nextStatus` desejado e o pipeline precisa registrar um evento de
 * `status_changed` com a ação correspondente. A regra de seleção segue
 * a semântica natural do produto:
 *
 * - `aberto → andamento`            → `ASSIGN`
 * - `aberto | andamento → aguardando` → `WAIT_REQUESTER`
 * - `aguardando | resolvido → andamento` → `RESPOND`
 * - `* → resolvido`                 → `RESOLVE`
 * - `resolvido | fechado → aberto`  → `REOPEN`
 * - `* → fechado`                   → `CLOSE`
 *
 * Para qualquer outro par `(current, next)` — incluindo identidades sem
 * ação canônica como `aberto → aberto` — lança
 * `IllegalStateTransitionError(current, null, next)`. A legalidade
 * efetiva é re-validada pelo caller via `transitionTicketStatus`, de
 * modo que pares cobertos pelas regras mas inaceitos pela tabela
 * (ex.: `fechado → resolvido`) ainda falham downstream com erro
 * preciso indicando a ação proposta.
 */
export function deriveAction(
    current: TicketStatus,
    next: TicketStatus,
): TicketAction {
    if (current === "aberto" && next === "andamento") return "ASSIGN";
    if (
        (current === "aberto" || current === "andamento") &&
        next === "aguardando"
    ) {
        return "WAIT_REQUESTER";
    }
    if (
        (current === "aguardando" || current === "resolvido") &&
        next === "andamento"
    ) {
        return "RESPOND";
    }
    if (next === "resolvido") return "RESOLVE";
    if ((current === "resolvido" || current === "fechado") && next === "aberto") {
        return "REOPEN";
    }
    if (next === "fechado") return "CLOSE";

    throw new IllegalStateTransitionError(current, null, next);
}

/**
 * Retorna os próximos status alcançáveis a partir de `current` pela
 * tabela de transições — isto é, todos os `next` distintos do próprio
 * `current` que aparecem como destino para alguma ação válida.
 *
 * Útil para a UI popular dropdowns de mudança de status sem precisar
 * embutir a tabela: basta iterar `getValidTransitions(ticket.status)`
 * e oferecer cada destino como opção. A semântica "exclui o estado
 * atual" reflete que repetir o status corrente é uma no-op
 * (idempotência) e não vale como opção exposta ao usuário.
 *
 * Pureza/total: como `transitionTicketStatus`, esta função é pura,
 * determinística e baseada apenas na tabela `TRANSITIONS`. A ordem
 * de retorno segue a ordem natural de `TicketStatus` declarada em
 * `types/domain.ts`, garantindo apresentação estável.
 */
export function getValidTransitions(
    current: TicketStatus,
): readonly TicketStatus[] {
    const targets = new Set<TicketStatus>();
    for (const next of Object.values(TRANSITIONS[current])) {
        if (next && next !== current) targets.add(next);
    }
    // Ordem canônica de `TicketStatus` para apresentação estável.
    const ORDER: readonly TicketStatus[] = [
        "aberto",
        "andamento",
        "aguardando",
        "resolvido",
        "fechado",
    ];
    return ORDER.filter((s) => targets.has(s));
}
