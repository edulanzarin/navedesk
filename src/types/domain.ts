/**
 * Tipos de domínio do NaveDesk.
 *
 * Este módulo concentra os tipos compartilhados pelo núcleo puro (`lib/`),
 * pelos serviços de domínio, pelas Server Actions e pelos componentes de UI.
 * Mantê-los em um único lugar garante coerência entre a borda (validação Zod),
 * o banco (Drizzle) e a apresentação (React).
 *
 * Validates: R2, R3, R4, R6, R22.
 */

/**
 * Papéis de usuário no sistema.
 *
 * - `solicitante`: usuário final que abre e acompanha apenas os próprios tickets.
 * - `tecnico`: atende tickets, posta mensagens internas e altera status.
 * - `admin`: super-conjunto de `tecnico` com gestão de usuários, SLA e categorias.
 */
export type Role = "solicitante" | "tecnico" | "admin";

/**
 * Prioridade do ticket. Define a janela de SLA aplicada na criação.
 */
export type Priority = "baixa" | "media" | "alta" | "critica";

/**
 * Estados possíveis de um ticket conforme a máquina de estados do design.
 */
export type TicketStatus =
    | "aberto"
    | "andamento"
    | "aguardando"
    | "resolvido"
    | "fechado";

/**
 * Ações que disparam transições na máquina de estados de tickets.
 *
 * - `ASSIGN`: técnico assume o ticket, levando-o a `andamento`.
 * - `WAIT_REQUESTER`: técnico aguarda retorno do solicitante.
 * - `RESPOND`: solicitante responde, retomando o atendimento.
 * - `RESOLVE`: técnico marca como resolvido.
 * - `REOPEN`: solicitante reabre um ticket resolvido/fechado.
 * - `CLOSE`: encerra definitivamente um ticket resolvido.
 */
export type TicketAction =
    | "ASSIGN"
    | "WAIT_REQUESTER"
    | "RESPOND"
    | "RESOLVE"
    | "REOPEN"
    | "CLOSE";

/**
 * Representação de um ticket no domínio.
 *
 * O `id` segue o formato `NVD-{n}` gerado a partir da sequência `ticket_seq`.
 * Datas são sempre `Date` (UTC) — a serialização para o cliente é responsabilidade
 * da camada de apresentação.
 */
export interface Ticket {
    /** Identificador legível, p.ex. `"NVD-1043"`. */
    id: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: Priority;
    categoryId: string;
    departmentId: string;
    requesterId: string;
    /** Técnico responsável pelo ticket; `null` enquanto não atribuído. */
    assigneeId: string | null;
    /** Avaliação pós-resolução (1 a 5); `null` quando ainda não avaliado. */
    rating: 1 | 2 | 3 | 4 | 5 | null;
    createdAt: Date;
    updatedAt: Date;
    /** Prazo do SLA calculado a partir da política vigente na criação. */
    slaDeadline: Date;
    resolvedAt: Date | null;
    closedAt: Date | null;
}

/**
 * Snapshot do usuário autenticado disponibilizado pela sessão Auth.js.
 *
 * Contém apenas o necessário para autorização e exibição — nunca expõe
 * `passwordHash` ou outros campos sensíveis.
 *
 * `avatarColor`/`avatarUrl` são opcionais por compatibilidade com
 * código que constrói `SessionUser` literais (testes, fixtures); em
 * tempo de execução real, o JWT sempre carrega os dois (a UI cai em
 * defaults seguros — `--accent` para a cor, iniciais para a foto —
 * quando ausentes).
 */
export interface SessionUser {
    id: string;
    email: string;
    name: string;
    role: Role;
    /** Departamento de lotação; `null` para admins sem vínculo. */
    departmentId: string | null;
    /** Cor hexadecimal usada como fallback do avatar. */
    avatarColor?: string;
    /** URL da foto de perfil; `null` quando o usuário usa só iniciais. */
    avatarUrl?: string | null;
}

/**
 * Política de SLA por prioridade. `minutes` define o prazo total em
 * minutos a partir da criação do ticket. A unidade é minutos (e não
 * horas) para permitir prazos sub-hora — ex.: 30 minutos para
 * prioridade `critica`.
 */
export interface SlaPolicy {
    priority: Priority;
    minutes: number;
}

/**
 * Informações derivadas do SLA em um instante específico.
 *
 * - `level`:
 *   - `ok`: dentro do prazo, > 25% restante.
 *   - `warn`: ≤ 25% restante.
 *   - `crit`: ≤ 10% restante.
 *   - `breached`: prazo vencido (`remainingMs < 0`).
 * - `remainingMs`: tempo restante em milissegundos. Negativo quando vencido.
 * - `pctElapsed`: percentual decorrido, fixado entre 0 e 100.
 */
export interface SlaInfo {
    level: "ok" | "warn" | "crit" | "breached";
    remainingMs: number;
    pctElapsed: number;
}

/**
 * Resultado discriminado para Server Actions e serviços.
 *
 * Permite que a borda diferencie sucesso (`ok: true`, com `data`) de falhas
 * tratáveis (`ok: false`, com `error.code` legível por máquina e
 * `error.message` para o usuário). `field` é opcional e amarra o erro a um
 * campo de formulário específico, útil para `react-hook-form`.
 */
export type ActionResult<T> =
    | { ok: true; data: T }
    | {
        ok: false;
        error: {
            code: string;
            message: string;
            field?: string;
        };
    };
