/**
 * Drizzle schema for NaveDesk.
 *
 * Defines all enums, tables, and indexes that back the helpdesk domain:
 * users/RBAC, tickets and their lifecycle (messages, events, attachments),
 * SLA policies, taxonomy (departments, categories) and the knowledge base.
 *
 * See `.kiro/specs/navedesk-helpdesk/design.md` ("Tabelas (Drizzle /
 * PostgreSQL)") for the canonical specification.
 */

import {
    boolean,
    index,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("role", ["solicitante", "tecnico", "admin"]);

export const statusEnum = pgEnum("ticket_status", [
    "aberto",
    "andamento",
    "aguardando",
    "resolvido",
    "fechado",
]);

export const priorityEnum = pgEnum("priority", [
    "baixa",
    "media",
    "alta",
    "critica",
]);

export const eventTypeEnum = pgEnum("event_type", [
    "created",
    "status_changed",
    "priority_changed",
    "assigned",
    "unassigned",
    "rated",
    "closed",
]);

/**
 * Tipos de notificação enviados aos usuários.
 *
 * Cobrem o ciclo de vida operacional do ticket: criação (vai pra
 * técnicos/admins), mudanças de estado/prioridade/atribuição (vão pra
 * requester e/ou assignee), e mensagens (vão pra contraparte da
 * conversa). Notas internas geram `message_internal` apenas para
 * o responsável atual quando ele não é o autor.
 */
export const notificationTypeEnum = pgEnum("notification_type", [
    "ticket_created",
    "ticket_assigned",
    "ticket_unassigned",
    "ticket_status_changed",
    "ticket_priority_changed",
    "ticket_resolved",
    "ticket_closed",
    "message_public",
    "message_internal",
    "ticket_rated",
]);

// ---------------------------------------------------------------------------
// Reference / configuration tables
// ---------------------------------------------------------------------------

export const departments = pgTable("departments", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
});

export const categories = pgTable("categories", {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    sub: text("sub").notNull(),
    icon: text("icon").notNull(),
    active: boolean("active").notNull().default(true),
});

export const slaPolicies = pgTable("sla_policies", {
    // `minutes` armazena o prazo total em minutos. A migração manual
    // 0003_sla_minutes.sql renomeia a coluna antiga `hours` e converte
    // os valores. Minutos permitem expressar prazos sub-hora (ex.: 30
    // min para `critica`).
    priority: priorityEnum("priority").primaryKey(),
    minutes: integer("minutes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull().default("solicitante"),
    departmentId: uuid("department_id").references(() => departments.id),
    avatarColor: text("avatar_color").notNull().default("#5E5CE6"),
    avatarUrl: text("avatar_url"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
    "tickets",
    {
        id: text("id").primaryKey(), // ex.: "NVD-1043"
        title: text("title").notNull(),
        description: text("description").notNull(),
        status: statusEnum("status").notNull().default("aberto"),
        priority: priorityEnum("priority").notNull().default("media"),
        categoryId: text("category_id")
            .notNull()
            .references(() => categories.id),
        departmentId: uuid("department_id")
            .notNull()
            .references(() => departments.id),
        requesterId: uuid("requester_id")
            .notNull()
            .references(() => users.id),
        assigneeId: uuid("assignee_id").references(() => users.id),
        rating: integer("rating"), // 1..5, ou null
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        slaDeadline: timestamp("sla_deadline", { withTimezone: true }).notNull(),
        resolvedAt: timestamp("resolved_at", { withTimezone: true }),
        closedAt: timestamp("closed_at", { withTimezone: true }),
    },
    (t) => ({
        idxStatus: index("tickets_status_idx").on(t.status),
        idxAssignee: index("tickets_assignee_idx").on(t.assigneeId),
        idxRequester: index("tickets_requester_idx").on(t.requesterId),
        idxDeadline: index("tickets_deadline_idx").on(t.slaDeadline),
    }),
);

export const ticketMessages = pgTable(
    "ticket_messages",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ticketId: text("ticket_id")
            .notNull()
            .references(() => tickets.id, { onDelete: "cascade" }),
        authorId: uuid("author_id")
            .notNull()
            .references(() => users.id),
        body: text("body").notNull(),
        isInternal: boolean("is_internal").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        idxTicket: index("messages_ticket_idx").on(t.ticketId, t.createdAt),
    }),
);

export const ticketEvents = pgTable(
    "ticket_events",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ticketId: text("ticket_id")
            .notNull()
            .references(() => tickets.id, { onDelete: "cascade" }),
        type: eventTypeEnum("type").notNull(),
        actorId: uuid("actor_id")
            .notNull()
            .references(() => users.id),
        fromValue: text("from_value"),
        toValue: text("to_value"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        idxTicket: index("events_ticket_idx").on(t.ticketId, t.createdAt),
    }),
);

export const attachments = pgTable("attachments", {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: text("ticket_id").references(() => tickets.id, {
        onDelete: "cascade",
    }),
    messageId: uuid("message_id").references(() => ticketMessages.id, {
        onDelete: "cascade",
    }),
    uploaderId: uuid("uploader_id")
        .notNull()
        .references(() => users.id),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export const kbCategories = pgTable("kb_categories", {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    icon: text("icon").notNull(),
});

export const kbArticles = pgTable("kb_articles", {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull(), // markdown
    categoryId: text("category_id")
        .notNull()
        .references(() => kbCategories.id),
    authorId: uuid("author_id")
        .notNull()
        .references(() => users.id),
    views: integer("views").notNull().default(0),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Caixa de notificações pessoal de cada usuário.
 *
 * Cada linha é uma notificação dirigida a `userId`. Quando algo
 * acontece em um ticket (criação, mudança de estado, mensagem), os
 * serviços de domínio fazem fan-out: enfileiram uma linha aqui pra
 * cada destinatário (técnicos no caso de criação; requester e/ou
 * assignee no caso de updates).
 *
 * Convenções:
 * - `readAt` permanece `null` enquanto não lida; é marcado com a hora
 *   em que o usuário entra na página de notificações.
 * - `actorId` é o autor da ação que gerou a notificação. `null` para
 *   eventos automáticos (ex.: auto-fechamento de ticket pelo cron).
 * - `ticketId` referencia o ticket alvo; `ON DELETE CASCADE` garante
 *   que apagar um ticket apague suas notificações.
 *
 * Índice composto `(user_id, created_at DESC)` cobre a listagem
 * paginada (mais recentes primeiro). Índice parcial `WHERE read_at IS
 * NULL` acelera o badge de não-lidas, que é consultado a cada 30s
 * via polling.
 */
export const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        ticketId: text("ticket_id").references(() => tickets.id, {
            onDelete: "cascade",
        }),
        type: notificationTypeEnum("type").notNull(),
        title: text("title").notNull(),
        body: text("body"),
        actorId: uuid("actor_id").references(() => users.id, {
            onDelete: "set null",
        }),
        readAt: timestamp("read_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        idxUserCreated: index("notifications_user_created_idx").on(
            t.userId,
            t.createdAt,
        ),
    }),
);

// ---------------------------------------------------------------------------
// Ticket templates
// ---------------------------------------------------------------------------

/**
 * Modelos pré-preenchidos para abertura de tickets ("Reset de senha",
 * "Configurar VPN", etc.). Admins gerenciam; solicitantes escolhem
 * um template no formulário de novo ticket e os campos chegam
 * preenchidos para edição livre antes do submit.
 */
export const ticketTemplates = pgTable(
    "ticket_templates",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        name: text("name").notNull(),
        title: text("title").notNull(),
        description: text("description").notNull(),
        priority: priorityEnum("priority").notNull().default("media"),
        categoryId: text("category_id")
            .notNull()
            .references(() => categories.id),
        departmentId: uuid("department_id").references(() => departments.id),
        active: boolean("active").notNull().default(true),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        idxActive: index("ticket_templates_active_idx").on(t.active, t.name),
    }),
);

// ---------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------

/**
 * Filtros salvos por usuário (ex.: "Meus em andamento", "Sem
 * responsável críticos"). `queryString` armazena o suffix da URL
 * sem o `?` inicial; a página de tickets só aplica `?<query>` ao
 * link e o restante (parsing) já é resolvido pelos `searchParams`
 * existentes.
 */
export const savedFilters = pgTable(
    "saved_filters",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        queryString: text("query_string").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        idxUser: index("saved_filters_user_idx").on(t.userId, t.createdAt),
    }),
);
