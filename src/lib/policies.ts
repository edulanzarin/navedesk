/**
 * Políticas de autorização (RBAC) do NaveDesk.
 *
 * Este módulo concentra **funções puras** que decidem se um usuário pode
 * executar uma ação sobre um recurso específico. As policies não realizam
 * I/O nem dependem de relógio: recebem o `SessionUser` da requisição e os
 * dados já carregados (ticket, anexo) e retornam `boolean`.
 *
 * Hierarquia de papéis (do mais permissivo ao mais restrito):
 *
 * - `admin`: superusuário; concede todas as operações de domínio,
 *   inclusive gestão de usuários, políticas de SLA e categorias.
 * - `tecnico`: atende tickets, assume responsabilidade, altera status,
 *   prioridade e atribuição, posta notas internas.
 * - `solicitante`: opera apenas sobre os próprios tickets (visualização,
 *   resposta, avaliação e confirmação de fechamento).
 *
 * As policies são chamadas em **duas camadas**: a UI esconde controles
 * proibidos e o serviço **revalida** antes de qualquer escrita. Manter a
 * lógica em um único lugar puro evita drift entre as duas verificações.
 *
 * Validates: R2, R5.1, R5.6, R7.3, R8.7, R12.7, R13.9, R14.
 */

import type { SessionUser, Ticket, TicketStatus } from "@/types/domain";

/**
 * Forma mínima de um anexo necessária para `canReadAttachment`.
 *
 * Aceita o registro persistido em `attachments` ou qualquer projeção que
 * exponha `uploaderId` e `ticketId`. Mantemos o tipo localizado para não
 * acoplar o núcleo puro ao schema do Drizzle.
 */
export interface AttachmentLike {
    /** Usuário que enviou o anexo. */
    uploaderId: string;
    /** Ticket ao qual o anexo está vinculado, ou `null` se ainda não associado. */
    ticketId: string | null;
    /**
     * Mensagem do ticket à qual o anexo está vinculado, ou `null`. Anexos
     * **órfãos** (com `ticketId` E `messageId` ambos `null`) representam
     * arquivos referenciados inline em artigos da Base de Conhecimento
     * — o `canReadAttachment` libera leitura nesses casos para qualquer
     * usuário autenticado.
     */
    messageId: string | null;
}

/**
 * Permite criar um novo ticket.
 *
 * Qualquer papel autenticado (e ativo, garantia da camada de Auth.js) pode
 * abrir chamados. Solicitantes registram demandas próprias; técnicos e
 * admins podem abrir em nome de terceiros via fluxos administrativos.
 */
export function canCreateTicket(user: SessionUser): boolean {
    return (
        user.role === "admin" ||
        user.role === "tecnico" ||
        user.role === "solicitante"
    );
}

/**
 * Permite visualizar o ticket informado.
 *
 * - `admin` e `tecnico`: enxergam todos os tickets do sistema.
 * - `solicitante`: enxerga apenas os chamados em que `requesterId === user.id`.
 *
 * Esta policy também é o predicado base para listagens: o repositório
 * aplica o mesmo filtro no SQL para tickets de solicitantes.
 */
export function canViewTicket(user: SessionUser, ticket: Ticket): boolean {
    if (user.role === "admin" || user.role === "tecnico") return true;
    return ticket.requesterId === user.id;
}

/**
 * Permite mudar o status do ticket para `next`.
 *
 * Retorna `true` se e somente se:
 * 1. `user.role === "admin"`, ou
 * 2. `user.role === "tecnico"` e `ticket.assigneeId === user.id`, ou
 * 3. `user.role === "solicitante"`, `ticket.requesterId === user.id`,
 *    `ticket.status === "resolvido"` e `next === "fechado"` (solicitante
 *    confirmando fechamento do próprio ticket).
 *
 * A validade da transição (estado → ação) em si é responsabilidade da
 * máquina de estados em `lib/ticket-state.ts`; aqui tratamos apenas da
 * permissão de papel.
 */
export function canChangeStatus(
    user: SessionUser,
    ticket: Ticket,
    next: TicketStatus
): boolean {
    if (user.role === "admin") return true;
    if (user.role === "tecnico" && ticket.assigneeId === user.id) return true;
    if (
        user.role === "solicitante" &&
        ticket.requesterId === user.id &&
        ticket.status === "resolvido" &&
        next === "fechado"
    ) {
        return true;
    }
    return false;
}

/**
 * Permite alterar a prioridade do ticket.
 *
 * Apenas `admin` ou o `tecnico` responsável pelo ticket podem reclassificar.
 * Solicitantes nunca podem mudar prioridade após a criação.
 */
export function canChangePriority(user: SessionUser, ticket: Ticket): boolean {
    if (user.role === "admin") return true;
    if (user.role === "tecnico" && ticket.assigneeId === user.id) return true;
    return false;
}

/**
 * Permite que o próprio usuário assuma o ticket (auto-atribuição).
 *
 * `admin` e `tecnico` podem se atribuir, mas tickets já `fechado` ficam
 * imutáveis: não há atendimento a iniciar em um ticket encerrado.
 * Solicitantes nunca podem se atribuir.
 */
export function canAssignSelf(user: SessionUser, ticket: Ticket): boolean {
    if (ticket.status === "fechado") return false;
    return user.role === "admin" || user.role === "tecnico";
}

/**
 * Permite atribuir o ticket a outro usuário (designar terceiro).
 *
 * Apenas `admin` pode reatribuir entre técnicos. A validação de que o
 * destinatário existe, está ativo e tem papel compatível (`tecnico` ou
 * `admin`) ocorre na camada de serviço.
 */
export function canAssignOthers(user: SessionUser): boolean {
    return user.role === "admin";
}

/**
 * Permite postar uma mensagem como **nota interna** (`isInternal=true`).
 *
 * Notas internas são visíveis apenas para `admin` e `tecnico`; portanto
 * apenas esses papéis podem produzi-las. Solicitantes só postam mensagens
 * públicas em seus próprios tickets — verificação de visibilidade do
 * ticket é responsabilidade de `canViewTicket`.
 */
export function canPostInternalNote(user: SessionUser): boolean {
    return user.role === "admin" || user.role === "tecnico";
}

/**
 * Permite baixar/visualizar um anexo.
 *
 * - `admin` e `tecnico`: leitura irrestrita.
 * - `solicitante`: pode ler se foi quem enviou o anexo
 *   (`uploaderId === user.id`), se o anexo pertence a um ticket que ele
 *   mesmo abriu, ou se o anexo é **órfão** (sem `ticketId` e sem
 *   `messageId`). Anexos órfãos representam arquivos referenciados
 *   inline em artigos da Base de Conhecimento (imagens/vídeos colados
 *   no markdown), os quais já são visíveis a qualquer usuário
 *   autenticado via página do artigo. O ID é um UUIDv4 não-enumerável,
 *   então liberar leitura por id direto não cria superfície adicional
 *   além da própria página do KB.
 *
 * O parâmetro `ticket` é opcional para permitir checagem antes de
 * resolver o ticket associado. Quando fornecido, deve ser o ticket
 * referenciado por `attachment.ticketId`.
 */
export function canReadAttachment(
    user: SessionUser,
    attachment: AttachmentLike,
    ticket?: Ticket | null
): boolean {
    if (user.role === "admin" || user.role === "tecnico") return true;
    if (attachment.uploaderId === user.id) return true;
    if (ticket && ticket.requesterId === user.id) return true;
    // Anexo órfão (não vinculado a ticket nem a mensagem) é tratado
    // como recurso público para usuários autenticados — caso típico de
    // imagem/vídeo embutido em artigo KB.
    if (attachment.ticketId === null && attachment.messageId === null) {
        return true;
    }
    return false;
}

/**
 * Permite avaliar (rating 1..5) o atendimento.
 *
 * Apenas o solicitante autor do ticket pode avaliar, e somente quando o
 * ticket está em `resolvido` (avaliação acompanha a confirmação de
 * fechamento). Tickets já `fechado` não recebem nova avaliação.
 */
export function canRateTicket(user: SessionUser, ticket: Ticket): boolean {
    return (
        user.role === "solicitante" &&
        ticket.requesterId === user.id &&
        ticket.status === "resolvido"
    );
}

/**
 * Permite operar o cadastro de usuários (criar, ativar/desativar,
 * alterar papel). Restrito a `admin`.
 */
export function canManageUsers(user: SessionUser): boolean {
    return user.role === "admin";
}

/**
 * Permite editar políticas de SLA (horas por prioridade). Restrito a `admin`.
 *
 * Mudanças preservam deadlines de tickets já existentes; o cache de
 * políticas é invalidado pela camada de serviço.
 */
export function canManageSla(user: SessionUser): boolean {
    return user.role === "admin";
}

/**
 * Permite criar/desativar/excluir categorias do catálogo. Restrito a `admin`.
 */
export function canManageCategories(user: SessionUser): boolean {
    return user.role === "admin";
}

/**
 * Permite criar/renomear/excluir departamentos. Restrito a `admin`.
 *
 * Departamentos são uma taxonomia organizacional usada para escopar
 * tickets (`tickets.departmentId`) e atribuir usuários
 * (`users.departmentId`). Permitir outros papéis criaria risco de
 * proliferação descontrolada da taxonomia.
 */
export function canManageDepartments(user: SessionUser): boolean {
    return user.role === "admin";
}

/**
 * Permite criar artigos da base de conhecimento.
 *
 * `admin` e `tecnico` podem redigir artigos; solicitantes apenas
 * consultam. A publicação efetiva (`published=true`) pode exigir aprovação
 * adicional pela camada de serviço.
 */
export function canCreateKbArticle(user: SessionUser): boolean {
    return user.role === "admin" || user.role === "tecnico";
}

/**
 * Forma mínima de um artigo da KB necessária para `canEditKbArticle` /
 * `canDeleteKbArticle`. Mantido localizado para não acoplar o módulo de
 * policies ao schema do Drizzle.
 */
export interface KbArticleLike {
    /** Usuário que originalmente redigiu o artigo. */
    authorId: string;
}

/**
 * Permite editar um artigo da Base de Conhecimento existente.
 *
 * - `admin`: edita qualquer artigo.
 * - `tecnico`: edita somente os próprios artigos
 *   (`article.authorId === user.id`).
 * - `solicitante`: nunca edita.
 *
 * Mudança de autoria não é tratada aqui (mantemos `authorId` imutável
 * por design — preserva a auditoria); a policy só decide se a edição
 * em si é permitida.
 */
export function canEditKbArticle(
    user: SessionUser,
    article: KbArticleLike,
): boolean {
    if (user.role === "admin") return true;
    if (user.role === "tecnico" && article.authorId === user.id) return true;
    return false;
}

/**
 * Permite excluir um artigo da Base de Conhecimento.
 *
 * Mesmas regras de `canEditKbArticle`: o admin pode tudo, o técnico
 * remove apenas o que ele mesmo escreveu, solicitantes nunca excluem.
 *
 * Mantemos a policy separada da edição (mesmo que hoje sejam idênticas)
 * porque a UI revoga capacidades de forma independente — botão "Excluir"
 * pode sumir antes do botão "Editar" no futuro sem precisar mexer na
 * regra de edição.
 */
export function canDeleteKbArticle(
    user: SessionUser,
    article: KbArticleLike,
): boolean {
    if (user.role === "admin") return true;
    if (user.role === "tecnico" && article.authorId === user.id) return true;
    return false;
}

/**
 * Permite exportar a listagem de tickets para `.csv`/`.xlsx`.
 *
 * Todos os papéis autenticados podem exportar (R11.6). A restrição de
 * escopo do solicitante (R11.7 — "apenas tickets cujo `requesterId` é o
 * seu próprio") é aplicada automaticamente em
 * `tickets.repo.listWithFilters`, que injeta o filtro `requesterId =
 * user.id` no SQL para qualquer chamador com `role === "solicitante"`,
 * independentemente do que vier nos filtros do cliente.
 *
 * Manter este predicado puro e separado dos demais ajuda a UI a esconder
 * o botão "Exportar" para usuários sem permissão (caso a regra mude no
 * futuro), e dá ao serviço de export um único ponto a consultar antes
 * de iterar páginas do banco.
 */
export function canExportTickets(user: SessionUser): boolean {
    return (
        user.role === "admin" ||
        user.role === "tecnico" ||
        user.role === "solicitante"
    );
}
