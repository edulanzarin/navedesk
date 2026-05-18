/**
 * Espelho TypeScript dos tokens de design do NaveDesk.
 *
 * Este módulo é a contraparte tipada de `src/styles/tokens.css`. As paletas e
 * variáveis CSS continuam sendo a fonte da verdade visual; aqui expomos apenas
 * o que precisa atravessar a fronteira para os componentes (mapas de tom por
 * status/prioridade e os rótulos pt-BR oficiais).
 *
 * Mantemos os mapeamentos imutáveis (`as const`) para que o TypeScript
 * preserve os literais e evite que o consumidor inadvertidamente atribua um
 * tom inexistente. Os rótulos de status e prioridade são reexportados de
 * `constants.ts` para que exista um único lugar onde alterá-los.
 *
 * Validates: R19.2, R19.5, R19.6, R20.4
 */

import {
    PRIORITY_LABELS_PT,
    STATUS_LABELS_PT,
    type Priority,
    type TicketAction,
    type TicketStatus,
} from "@/lib/constants";

/**
 * Tons aceitos pelo primitivo `Badge` (ver `components/ui/badge.tsx`).
 *
 * Definir o tipo aqui — em vez de em `badge.tsx` — desacopla os mapeamentos
 * de domínio do componente e evita import circular: componentes de domínio
 * importam apenas `design-tokens`.
 */
export type BadgeTone =
    | "indigo"
    | "blue"
    | "green"
    | "amber"
    | "red"
    | "grey";

/**
 * Mapeamentos de tom por enumeração de domínio.
 *
 * Espelha exatamente a tabela definida em `design.md` e em R19.5/R19.6:
 *
 * - `status.aberto`     → `blue`  (acabou de chegar; aguarda triagem)
 * - `status.andamento`  → `amber` (em atendimento ativo)
 * - `status.aguardando` → `grey`  (pausado aguardando solicitante)
 * - `status.resolvido`  → `green` (resolução proposta, aguarda fechamento)
 * - `status.fechado`    → `grey`  (encerrado; estado terminal)
 *
 * - `priority.baixa`    → `grey`
 * - `priority.media`    → `blue`
 * - `priority.alta`     → `amber`
 * - `priority.critica`  → `red`
 *
 * O `satisfies` assegura cobertura exaustiva: qualquer novo status ou
 * prioridade adicionado em `constants.ts` causa erro de compilação aqui.
 */
export const tone = {
    status: {
        aberto: "blue",
        andamento: "amber",
        aguardando: "grey",
        resolvido: "green",
        fechado: "grey",
    },
    priority: {
        baixa: "grey",
        media: "blue",
        alta: "amber",
        critica: "red",
    },
} as const satisfies {
    status: Record<TicketStatus, BadgeTone>;
    priority: Record<Priority, BadgeTone>;
};

/**
 * Rótulos pt-BR para ações da máquina de estados de tickets.
 *
 * Usado por menus, botões e mensagens de confirmação. Reflete o vocabulário
 * dos eventos exibidos na trilha de auditoria.
 */
export const ACTION_LABELS_PT: Record<TicketAction, string> = {
    ASSIGN: "Assumir",
    WAIT_REQUESTER: "Aguardar solicitante",
    RESPOND: "Responder",
    RESOLVE: "Resolver",
    REOPEN: "Reabrir",
    CLOSE: "Fechar",
};

/**
 * Reexporta os rótulos de status e prioridade já definidos em `constants.ts`
 * para que componentes que precisem só dos tokens de design tenham um único
 * ponto de importação.
 */
export { STATUS_LABELS_PT, PRIORITY_LABELS_PT };
