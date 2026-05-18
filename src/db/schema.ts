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
