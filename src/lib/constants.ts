/**
 * Constantes de domínio do NaveDesk.
 *
 * Listas literais (`as const`) e mapas de rótulos pt-BR usados pela UI,
 * pelos serviços e pelos schemas. Os identificadores internos (em pt-BR
 * sem acento) são a fonte da verdade no banco e nas regras de negócio;
 * os rótulos servem apenas para apresentação ao usuário final.
 *
 * Validates: R20.4
 */

/** Papéis suportados pelo RBAC. Ordem reflete escalada de permissões. */
export const ROLES = ["solicitante", "tecnico", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Prioridades de ticket. Ordem ascendente de severidade. */
export const PRIORITIES = ["baixa", "media", "alta", "critica"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Status do ciclo de vida de um ticket. */
export const STATUSES = [
    "aberto",
    "andamento",
    "aguardando",
    "resolvido",
    "fechado",
] as const;
export type TicketStatus = (typeof STATUSES)[number];

/** Tipos de eventos registrados na trilha de auditoria de tickets. */
export const EVENT_TYPES = [
    "created",
    "status_changed",
    "priority_changed",
    "assigned",
    "unassigned",
    "rated",
    "closed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Ações aceitas pela máquina de estados de tickets. */
export const TICKET_ACTIONS = [
    "ASSIGN",
    "WAIT_REQUESTER",
    "RESPOND",
    "RESOLVE",
    "REOPEN",
    "CLOSE",
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

/** Rótulos pt-BR oficiais para status de ticket. */
export const STATUS_LABELS_PT: Record<TicketStatus, string> = {
    aberto: "Aberto",
    andamento: "Em andamento",
    aguardando: "Aguardando solicitante",
    resolvido: "Resolvido",
    fechado: "Fechado",
};

/** Rótulos pt-BR oficiais para prioridade. */
export const PRIORITY_LABELS_PT: Record<Priority, string> = {
    baixa: "Baixa",
    media: "Média",
    alta: "Alta",
    critica: "Crítica",
};

/** Rótulos pt-BR oficiais para papéis (uso administrativo). */
export const ROLE_LABELS_PT: Record<Role, string> = {
    solicitante: "Solicitante",
    tecnico: "Técnico",
    admin: "Administrador",
};
