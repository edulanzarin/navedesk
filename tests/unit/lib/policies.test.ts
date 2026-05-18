/**
 * Testes unitários para as policies (RBAC) do NaveDesk.
 *
 * Cobre a matriz `(role, ação, recurso) → boolean` para cada função pura
 * em `src/lib/policies.ts`, com cenários positivos, negativos e de fronteira
 * (p.ex. técnico só altera status do ticket atribuído; solicitante só
 * fecha o próprio ticket resolvido).
 *
 * Validates: Requirements R2.1, R2.2, R2.3, R2.4
 */

import { describe, expect, it } from "vitest";

import {
    canAssignOthers,
    canAssignSelf,
    canChangePriority,
    canChangeStatus,
    canCreateKbArticle,
    canCreateTicket,
    canManageCategories,
    canManageSla,
    canManageUsers,
    canPostInternalNote,
    canRateTicket,
    canReadAttachment,
    canViewTicket,
    type AttachmentLike,
} from "@/lib/policies";
import type {
    Role,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// Helpers / Factories
// ---------------------------------------------------------------------------

const ROLES: readonly Role[] = ["admin", "tecnico", "solicitante"] as const;

const STATUSES: readonly TicketStatus[] = [
    "aberto",
    "andamento",
    "aguardando",
    "resolvido",
    "fechado",
] as const;

/**
 * Cria um usuário autenticado mínimo para testes de RBAC.
 */
function makeUser(role: Role, id = `user-${role}`): SessionUser {
    return {
        id,
        email: `${id}@navedesk.test`,
        name: `User ${id}`,
        role,
        departmentId: null,
    };
}

/**
 * Cria um ticket completo com defaults sensatos. Sobrescritas cobrem os
 * campos relevantes para cada policy.
 */
function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    const createdAt = new Date("2025-01-10T09:00:00Z");
    return {
        id: "NVD-1",
        title: "Sample ticket",
        description: "Sample description",
        status: "aberto",
        priority: "media",
        categoryId: "cat-1",
        departmentId: "dep-1",
        requesterId: "user-solicitante",
        assigneeId: null,
        rating: null,
        createdAt,
        updatedAt: createdAt,
        slaDeadline: new Date("2025-01-11T09:00:00Z"),
        resolvedAt: null,
        closedAt: null,
        ...overrides,
    };
}

/**
 * Cria a forma mínima de anexo aceita por `canReadAttachment`.
 */
function makeAttachment(
    overrides: Partial<AttachmentLike> = {}
): AttachmentLike {
    return {
        uploaderId: "user-solicitante",
        ticketId: "NVD-1",
        messageId: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// canCreateTicket — qualquer papel autenticado abre tickets
// ---------------------------------------------------------------------------

describe("canCreateTicket", () => {
    it.each(ROLES)("permite criar ticket para o papel %s", (role) => {
        expect(canCreateTicket(makeUser(role))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// canViewTicket — admin/tecnico veem tudo, solicitante vê apenas os próprios
// ---------------------------------------------------------------------------

describe("canViewTicket", () => {
    it("admin enxerga ticket de qualquer solicitante", () => {
        const admin = makeUser("admin", "admin-1");
        const ticket = makeTicket({ requesterId: "outro" });
        expect(canViewTicket(admin, ticket)).toBe(true);
    });

    it("tecnico enxerga ticket de qualquer solicitante", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ requesterId: "outro" });
        expect(canViewTicket(tecnico, ticket)).toBe(true);
    });

    it("solicitante enxerga apenas ticket onde requesterId é o seu id", () => {
        const solicitante = makeUser("solicitante", "sol-1");
        const proprio = makeTicket({ requesterId: "sol-1" });
        expect(canViewTicket(solicitante, proprio)).toBe(true);
    });

    it("solicitante NÃO enxerga ticket de outro solicitante", () => {
        const solicitante = makeUser("solicitante", "sol-1");
        const alheio = makeTicket({ requesterId: "sol-2" });
        expect(canViewTicket(solicitante, alheio)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canChangeStatus — matriz por papel × atribuição × status × próximo status
// ---------------------------------------------------------------------------

describe("canChangeStatus", () => {
    it("admin altera status para qualquer próximo estado, em qualquer ticket", () => {
        const admin = makeUser("admin", "admin-1");
        for (const current of STATUSES) {
            for (const next of STATUSES) {
                const ticket = makeTicket({
                    status: current,
                    requesterId: "outro",
                    assigneeId: "outro-tec",
                });
                expect(canChangeStatus(admin, ticket, next)).toBe(true);
            }
        }
    });

    it("tecnico atribuído altera status para qualquer próximo estado", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        for (const current of STATUSES) {
            for (const next of STATUSES) {
                const ticket = makeTicket({
                    status: current,
                    assigneeId: "tec-1",
                });
                expect(canChangeStatus(tecnico, ticket, next)).toBe(true);
            }
        }
    });

    it("tecnico NÃO altera status de ticket atribuído a outro técnico", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({
            status: "andamento",
            assigneeId: "tec-2",
        });
        expect(canChangeStatus(tecnico, ticket, "resolvido")).toBe(false);
    });

    it("tecnico NÃO altera status de ticket sem responsável", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ status: "aberto", assigneeId: null });
        expect(canChangeStatus(tecnico, ticket, "andamento")).toBe(false);
    });

    it("solicitante autor pode confirmar fechamento de ticket resolvido", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "sol-1",
        });
        expect(canChangeStatus(sol, ticket, "fechado")).toBe(true);
    });

    it("solicitante NÃO fecha ticket que pertence a outro solicitante", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "sol-2",
        });
        expect(canChangeStatus(sol, ticket, "fechado")).toBe(false);
    });

    it("solicitante NÃO fecha ticket que ainda não está resolvido", () => {
        const sol = makeUser("solicitante", "sol-1");
        for (const status of STATUSES.filter((s) => s !== "resolvido")) {
            const ticket = makeTicket({
                status,
                requesterId: "sol-1",
            });
            expect(canChangeStatus(sol, ticket, "fechado")).toBe(false);
        }
    });

    it("solicitante NÃO altera status para qualquer próximo estado diferente de fechado", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "sol-1",
        });
        for (const next of STATUSES.filter((s) => s !== "fechado")) {
            expect(canChangeStatus(sol, ticket, next)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// canChangePriority — admin sempre, técnico apenas se atribuído
// ---------------------------------------------------------------------------

describe("canChangePriority", () => {
    it("admin altera prioridade de qualquer ticket", () => {
        const admin = makeUser("admin", "admin-1");
        const ticket = makeTicket({ assigneeId: null });
        expect(canChangePriority(admin, ticket)).toBe(true);
    });

    it("tecnico atribuído altera prioridade do próprio ticket", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ assigneeId: "tec-1" });
        expect(canChangePriority(tecnico, ticket)).toBe(true);
    });

    it("tecnico NÃO altera prioridade de ticket atribuído a outro técnico", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ assigneeId: "tec-2" });
        expect(canChangePriority(tecnico, ticket)).toBe(false);
    });

    it("tecnico NÃO altera prioridade de ticket sem responsável", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ assigneeId: null });
        expect(canChangePriority(tecnico, ticket)).toBe(false);
    });

    it("solicitante NÃO altera prioridade nem do próprio ticket", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({ requesterId: "sol-1" });
        expect(canChangePriority(sol, ticket)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canAssignSelf — admin/tecnico podem se auto-atribuir, exceto em fechado
// ---------------------------------------------------------------------------

describe("canAssignSelf", () => {
    it("admin pode se auto-atribuir em qualquer status diferente de fechado", () => {
        const admin = makeUser("admin", "admin-1");
        for (const status of STATUSES.filter((s) => s !== "fechado")) {
            expect(canAssignSelf(admin, makeTicket({ status }))).toBe(true);
        }
    });

    it("tecnico pode se auto-atribuir em qualquer status diferente de fechado", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        for (const status of STATUSES.filter((s) => s !== "fechado")) {
            expect(canAssignSelf(tecnico, makeTicket({ status }))).toBe(true);
        }
    });

    it("admin NÃO pode se auto-atribuir em ticket fechado", () => {
        const admin = makeUser("admin", "admin-1");
        const ticket = makeTicket({ status: "fechado" });
        expect(canAssignSelf(admin, ticket)).toBe(false);
    });

    it("tecnico NÃO pode se auto-atribuir em ticket fechado", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({ status: "fechado" });
        expect(canAssignSelf(tecnico, ticket)).toBe(false);
    });

    it("solicitante NUNCA pode se auto-atribuir, mesmo em ticket aberto", () => {
        const sol = makeUser("solicitante", "sol-1");
        for (const status of STATUSES) {
            expect(canAssignSelf(sol, makeTicket({ status }))).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// canAssignOthers — apenas admin
// ---------------------------------------------------------------------------

describe("canAssignOthers", () => {
    it("admin pode atribuir terceiros", () => {
        expect(canAssignOthers(makeUser("admin"))).toBe(true);
    });

    it("tecnico NÃO pode atribuir terceiros", () => {
        expect(canAssignOthers(makeUser("tecnico"))).toBe(false);
    });

    it("solicitante NÃO pode atribuir terceiros", () => {
        expect(canAssignOthers(makeUser("solicitante"))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canPostInternalNote — admin e técnico apenas
// ---------------------------------------------------------------------------

describe("canPostInternalNote", () => {
    it("admin pode postar notas internas", () => {
        expect(canPostInternalNote(makeUser("admin"))).toBe(true);
    });

    it("tecnico pode postar notas internas", () => {
        expect(canPostInternalNote(makeUser("tecnico"))).toBe(true);
    });

    it("solicitante NÃO pode postar notas internas", () => {
        expect(canPostInternalNote(makeUser("solicitante"))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canReadAttachment — leitura irrestrita para staff; solicitante limitado
// ---------------------------------------------------------------------------

describe("canReadAttachment", () => {
    it("admin lê qualquer anexo independentemente do uploader/ticket", () => {
        const admin = makeUser("admin", "admin-1");
        const att = makeAttachment({
            uploaderId: "outro",
            ticketId: "NVD-99",
        });
        expect(canReadAttachment(admin, att)).toBe(true);
    });

    it("tecnico lê qualquer anexo independentemente do uploader/ticket", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const att = makeAttachment({
            uploaderId: "outro",
            ticketId: "NVD-99",
        });
        expect(canReadAttachment(tecnico, att)).toBe(true);
    });

    it("solicitante lê anexo que ele mesmo enviou", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({ uploaderId: "sol-1" });
        expect(canReadAttachment(sol, att)).toBe(true);
    });

    it("solicitante lê anexo de ticket que ele abriu mesmo se outro fez upload", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({
            uploaderId: "tec-1",
            ticketId: "NVD-1",
        });
        const ticket = makeTicket({ requesterId: "sol-1" });
        expect(canReadAttachment(sol, att, ticket)).toBe(true);
    });

    it("solicitante NÃO lê anexo de outro usuário em ticket alheio", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({
            uploaderId: "outro",
            ticketId: "NVD-99",
        });
        const ticket = makeTicket({ requesterId: "sol-2" });
        expect(canReadAttachment(sol, att, ticket)).toBe(false);
    });

    it("solicitante NÃO lê anexo alheio quando ticket associado não é fornecido", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({ uploaderId: "outro" });
        expect(canReadAttachment(sol, att)).toBe(false);
    });

    it("solicitante LÊ anexo órfão (ticketId e messageId nulos) — caso de imagem/vídeo embutido em artigo KB", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({
            uploaderId: "outro",
            ticketId: null,
            messageId: null,
        });
        expect(canReadAttachment(sol, att, null)).toBe(true);
    });

    it("solicitante NÃO lê anexo de mensagem alheia em ticket que não é dele", () => {
        const sol = makeUser("solicitante", "sol-1");
        const att = makeAttachment({
            uploaderId: "outro",
            ticketId: null,
            messageId: "msg-1",
        });
        expect(canReadAttachment(sol, att, null)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canRateTicket — apenas solicitante autor em ticket resolvido
// ---------------------------------------------------------------------------

describe("canRateTicket", () => {
    it("solicitante autor avalia ticket resolvido", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "sol-1",
        });
        expect(canRateTicket(sol, ticket)).toBe(true);
    });

    it("solicitante NÃO avalia ticket de outro usuário", () => {
        const sol = makeUser("solicitante", "sol-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "sol-2",
        });
        expect(canRateTicket(sol, ticket)).toBe(false);
    });

    it("solicitante NÃO avalia se status diferente de resolvido", () => {
        const sol = makeUser("solicitante", "sol-1");
        for (const status of STATUSES.filter((s) => s !== "resolvido")) {
            const ticket = makeTicket({
                status,
                requesterId: "sol-1",
            });
            expect(canRateTicket(sol, ticket)).toBe(false);
        }
    });

    it("admin NÃO avalia ticket (avaliação é direito do solicitante)", () => {
        const admin = makeUser("admin", "admin-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "admin-1",
        });
        expect(canRateTicket(admin, ticket)).toBe(false);
    });

    it("tecnico NÃO avalia ticket (avaliação é direito do solicitante)", () => {
        const tecnico = makeUser("tecnico", "tec-1");
        const ticket = makeTicket({
            status: "resolvido",
            requesterId: "tec-1",
        });
        expect(canRateTicket(tecnico, ticket)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// canManageUsers / canManageSla / canManageCategories — apenas admin
// ---------------------------------------------------------------------------

describe("canManageUsers", () => {
    it("admin pode administrar usuários", () => {
        expect(canManageUsers(makeUser("admin"))).toBe(true);
    });

    it.each(["tecnico", "solicitante"] as const)(
        "%s NÃO pode administrar usuários",
        (role) => {
            expect(canManageUsers(makeUser(role))).toBe(false);
        }
    );
});

describe("canManageSla", () => {
    it("admin pode editar políticas de SLA", () => {
        expect(canManageSla(makeUser("admin"))).toBe(true);
    });

    it.each(["tecnico", "solicitante"] as const)(
        "%s NÃO pode editar políticas de SLA",
        (role) => {
            expect(canManageSla(makeUser(role))).toBe(false);
        }
    );
});

describe("canManageCategories", () => {
    it("admin pode gerenciar categorias", () => {
        expect(canManageCategories(makeUser("admin"))).toBe(true);
    });

    it.each(["tecnico", "solicitante"] as const)(
        "%s NÃO pode gerenciar categorias",
        (role) => {
            expect(canManageCategories(makeUser(role))).toBe(false);
        }
    );
});

// ---------------------------------------------------------------------------
// canCreateKbArticle — admin e técnico
// ---------------------------------------------------------------------------

describe("canCreateKbArticle", () => {
    it("admin pode criar artigos da KB", () => {
        expect(canCreateKbArticle(makeUser("admin"))).toBe(true);
    });

    it("tecnico pode criar artigos da KB", () => {
        expect(canCreateKbArticle(makeUser("tecnico"))).toBe(true);
    });

    it("solicitante NÃO pode criar artigos da KB", () => {
        expect(canCreateKbArticle(makeUser("solicitante"))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Matriz consolidada (role × ação) → boolean para policies sem recurso
// ---------------------------------------------------------------------------

describe("matriz role × ação para policies sem dependência de recurso", () => {
    type RoleOnlyPolicy = (user: SessionUser) => boolean;

    interface Row {
        action: string;
        fn: RoleOnlyPolicy;
        admin: boolean;
        tecnico: boolean;
        solicitante: boolean;
    }

    const matrix: Row[] = [
        {
            action: "canCreateTicket",
            fn: canCreateTicket,
            admin: true,
            tecnico: true,
            solicitante: true,
        },
        {
            action: "canAssignOthers",
            fn: canAssignOthers,
            admin: true,
            tecnico: false,
            solicitante: false,
        },
        {
            action: "canPostInternalNote",
            fn: canPostInternalNote,
            admin: true,
            tecnico: true,
            solicitante: false,
        },
        {
            action: "canManageUsers",
            fn: canManageUsers,
            admin: true,
            tecnico: false,
            solicitante: false,
        },
        {
            action: "canManageSla",
            fn: canManageSla,
            admin: true,
            tecnico: false,
            solicitante: false,
        },
        {
            action: "canManageCategories",
            fn: canManageCategories,
            admin: true,
            tecnico: false,
            solicitante: false,
        },
        {
            action: "canCreateKbArticle",
            fn: canCreateKbArticle,
            admin: true,
            tecnico: true,
            solicitante: false,
        },
    ];

    for (const row of matrix) {
        it(`${row.action}: admin=${row.admin}, tecnico=${row.tecnico}, solicitante=${row.solicitante}`, () => {
            expect(row.fn(makeUser("admin"))).toBe(row.admin);
            expect(row.fn(makeUser("tecnico"))).toBe(row.tecnico);
            expect(row.fn(makeUser("solicitante"))).toBe(row.solicitante);
        });
    }
});
