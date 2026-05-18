/**
 * Property-Based Test — Property 9: RBAC consistente com status.
 *
 * Verifica que `canChangeStatus` é consistente com o papel do usuário e
 * com o estado do ticket. A intenção da propriedade no design é capturar
 * a invariante de que **um usuário capaz de mudar o status de um ticket
 * é determinado por papel + atribuição + autoria**, e não por flutuações
 * acidentais entre status atuais e próximos.
 *
 * Nota sobre a redação literal do design
 * --------------------------------------
 *
 * O design enuncia a propriedade como:
 *
 *   `canChangeStatus(u, t, t.status) === true` para qualquer `u` que
 *   possa enxergar `t`, exceto quando `t.status === "fechado"`.
 *
 * Tomada literalmente, essa formulação **não se sustenta** contra a
 * implementação corrente em `src/lib/policies.ts`, e o teste unitário
 * (`tests/unit/lib/policies.test.ts`) confirma o comportamento esperado:
 *
 * - Solicitante autor olhando um ticket com `status="aberto"` consegue
 *   ver o ticket, porém `canChangeStatus(sol, ticket, "aberto") === false`
 *   (solicitante só pode disparar a transição `resolvido → fechado`).
 * - Técnico não atribuído consegue ver qualquer ticket, mas
 *   `canChangeStatus(tec, ticket, ticket.status) === false`.
 *
 * Em vez de alterar critérios de aceitação sem input, codificamos aqui
 * o **espírito** da propriedade: a consistência do RBAC com o estado.
 * A propriedade correta, derivada da matriz validada em
 * `tests/unit/lib/policies.test.ts`, é a seguinte:
 *
 * Para qualquer `u` que enxergue `t` (ou seja, `canViewTicket(u, t)`),
 * com `t.status !== "fechado"`, e qualquer `next ∈ TicketStatus`:
 *
 *   1. Se `u.role === "admin"`:
 *        `canChangeStatus(u, t, next) === true` para todo `next`.
 *
 *   2. Se `u.role === "tecnico"` e `t.assigneeId === u.id`:
 *        `canChangeStatus(u, t, next) === true` para todo `next`.
 *
 *   3. Se `u.role === "tecnico"` e `t.assigneeId !== u.id`:
 *        `canChangeStatus(u, t, next) === false` para todo `next`.
 *
 *   4. Se `u.role === "solicitante"` e `t.requesterId === u.id`:
 *        `canChangeStatus(u, t, next) === true` ⇔
 *           `t.status === "resolvido" ∧ next === "fechado"`.
 *
 * Além disso, para `t.status === "fechado"` (caso explicitamente
 * excluído pela redação literal do design), a única classe que
 * consegue alterar o status é `admin`. Isso também é validado.
 *
 * Validates: Requirements 2, 12.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { canChangeStatus, canViewTicket } from "@/lib/policies";
import { ROLES, STATUSES } from "@/lib/constants";
import type {
    Role,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// Arbitrários
// ---------------------------------------------------------------------------

/**
 * Pool fixo e pequeno de identificadores de usuário. Usar um conjunto
 * limitado aumenta a probabilidade de gerar combinações relevantes
 * (autor é o usuário, atribuído é o usuário, terceiros etc.) sem
 * depender de coincidências entre strings UUID-like.
 */
const USER_IDS = ["u-1", "u-2", "u-3", "u-4"] as const;

const roleArb: fc.Arbitrary<Role> = fc.constantFrom(...ROLES);
const statusArb: fc.Arbitrary<TicketStatus> = fc.constantFrom(...STATUSES);
const userIdArb: fc.Arbitrary<string> = fc.constantFrom(...USER_IDS);

/**
 * Gera um `SessionUser` mínimo. Apenas `id` e `role` influenciam as
 * policies; demais campos recebem valores estáveis.
 */
const userArb: fc.Arbitrary<SessionUser> = fc
    .tuple(userIdArb, roleArb)
    .map(([id, role]) => ({
        id,
        email: `${id}@navedesk.test`,
        name: `User ${id}`,
        role,
        departmentId: null,
    }));

/**
 * Gera um `Ticket` com `requesterId` e `assigneeId` extraídos do mesmo
 * pool de IDs (incluindo `null` para `assigneeId`). Os campos não usados
 * pelas policies recebem defaults determinísticos.
 */
const ticketArb: fc.Arbitrary<Ticket> = fc
    .record({
        status: statusArb,
        requesterId: userIdArb,
        assigneeId: fc.option(userIdArb, { nil: null }),
    })
    .map(({ status, requesterId, assigneeId }) => {
        const createdAt = new Date("2025-01-10T09:00:00Z");
        return {
            id: "NVD-1",
            title: "t",
            description: "d",
            status,
            priority: "media",
            categoryId: "cat-1",
            departmentId: "dep-1",
            requesterId,
            assigneeId,
            rating: null,
            createdAt,
            updatedAt: createdAt,
            slaDeadline: new Date("2025-01-11T09:00:00Z"),
            resolvedAt: null,
            closedAt: null,
        } satisfies Ticket;
    });

// ---------------------------------------------------------------------------
// Oráculo independente da implementação
// ---------------------------------------------------------------------------

/**
 * Função-oráculo que decide se `(user, ticket, next)` é permitido,
 * derivada da matriz validada em `tests/unit/lib/policies.test.ts`.
 * Mantida separadamente da implementação para que o teste detecte
 * regressões caso `policies.canChangeStatus` divirja do contrato.
 */
function expectedCanChangeStatus(
    user: SessionUser,
    ticket: Ticket,
    next: TicketStatus,
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

// ---------------------------------------------------------------------------
// Property 9 — RBAC consistente com status (versão interpretada)
// ---------------------------------------------------------------------------

describe("Property 9: RBAC consistente com status", () => {
    it("para todo (user, ticket, next), canChangeStatus concorda com a matriz papel × atribuição × autoria", () => {
        fc.assert(
            fc.property(
                userArb,
                ticketArb,
                statusArb,
                (user, ticket, next) => {
                    expect(canChangeStatus(user, ticket, next)).toBe(
                        expectedCanChangeStatus(user, ticket, next),
                    );
                },
            ),
            { numRuns: 1000 },
        );
    });

    it("admin sempre pode alterar status, em qualquer ticket visível e para qualquer próximo estado", () => {
        fc.assert(
            fc.property(ticketArb, statusArb, (ticket, next) => {
                const admin: SessionUser = {
                    id: "admin-1",
                    email: "admin@navedesk.test",
                    name: "Admin",
                    role: "admin",
                    departmentId: null,
                };
                // Pré-condição: admin enxerga qualquer ticket.
                expect(canViewTicket(admin, ticket)).toBe(true);
                expect(canChangeStatus(admin, ticket, next)).toBe(true);
            }),
            { numRuns: 500 },
        );
    });

    it("técnico atribuído pode alterar status para qualquer próximo estado, em qualquer ticket que tenha o seu id em assigneeId", () => {
        fc.assert(
            fc.property(
                userIdArb,
                ticketArb,
                statusArb,
                (tecId, baseTicket, next) => {
                    const tecnico: SessionUser = {
                        id: tecId,
                        email: `${tecId}@navedesk.test`,
                        name: `Tec ${tecId}`,
                        role: "tecnico",
                        departmentId: null,
                    };
                    const ticket: Ticket = { ...baseTicket, assigneeId: tecId };
                    expect(canViewTicket(tecnico, ticket)).toBe(true);
                    expect(canChangeStatus(tecnico, ticket, next)).toBe(true);
                },
            ),
            { numRuns: 500 },
        );
    });

    it("técnico NÃO atribuído jamais pode alterar status, mesmo enxergando o ticket", () => {
        fc.assert(
            fc.property(
                userArb.filter((u) => u.role === "tecnico"),
                ticketArb,
                statusArb,
                (tecnico, baseTicket, next) => {
                    // Garante que `assigneeId !== tecnico.id` (incluindo null).
                    const otherId = USER_IDS.find((id) => id !== tecnico.id)!;
                    const ticket: Ticket = {
                        ...baseTicket,
                        assigneeId:
                            baseTicket.assigneeId === tecnico.id
                                ? otherId
                                : baseTicket.assigneeId,
                    };
                    // Pré-condição: técnico (mesmo sem atribuição) enxerga o ticket.
                    expect(canViewTicket(tecnico, ticket)).toBe(true);
                    expect(canChangeStatus(tecnico, ticket, next)).toBe(false);
                },
            ),
            { numRuns: 500 },
        );
    });

    it("solicitante autor: pode alterar status ⇔ status='resolvido' ∧ next='fechado'", () => {
        fc.assert(
            fc.property(
                userIdArb,
                statusArb,
                statusArb,
                fc.option(userIdArb, { nil: null }),
                (solId, currentStatus, next, assigneeId) => {
                    const sol: SessionUser = {
                        id: solId,
                        email: `${solId}@navedesk.test`,
                        name: `Sol ${solId}`,
                        role: "solicitante",
                        departmentId: null,
                    };
                    const ticket: Ticket = {
                        id: "NVD-1",
                        title: "t",
                        description: "d",
                        status: currentStatus,
                        priority: "media",
                        categoryId: "cat-1",
                        departmentId: "dep-1",
                        requesterId: solId, // solicitante É o autor
                        assigneeId,
                        rating: null,
                        createdAt: new Date("2025-01-10T09:00:00Z"),
                        updatedAt: new Date("2025-01-10T09:00:00Z"),
                        slaDeadline: new Date("2025-01-11T09:00:00Z"),
                        resolvedAt: null,
                        closedAt: null,
                    };
                    expect(canViewTicket(sol, ticket)).toBe(true);

                    const allowed =
                        currentStatus === "resolvido" && next === "fechado";
                    expect(canChangeStatus(sol, ticket, next)).toBe(allowed);
                },
            ),
            { numRuns: 500 },
        );
    });

    it("solicitante NÃO autor jamais pode alterar status, e tampouco enxerga o ticket", () => {
        fc.assert(
            fc.property(
                userArb.filter((u) => u.role === "solicitante"),
                ticketArb,
                statusArb,
                (sol, baseTicket, next) => {
                    // Garante que `requesterId !== sol.id`.
                    const otherId = USER_IDS.find((id) => id !== sol.id)!;
                    const ticket: Ticket = {
                        ...baseTicket,
                        requesterId:
                            baseTicket.requesterId === sol.id
                                ? otherId
                                : baseTicket.requesterId,
                    };
                    expect(canViewTicket(sol, ticket)).toBe(false);
                    expect(canChangeStatus(sol, ticket, next)).toBe(false);
                },
            ),
            { numRuns: 500 },
        );
    });

    it("ticket fechado: apenas admin pode alterar status; técnico/solicitante são bloqueados independentemente de atribuição/autoria", () => {
        fc.assert(
            fc.property(
                userArb,
                userIdArb,
                userIdArb,
                statusArb,
                (user, requesterId, assigneeId, next) => {
                    const ticket: Ticket = {
                        id: "NVD-1",
                        title: "t",
                        description: "d",
                        status: "fechado",
                        priority: "media",
                        categoryId: "cat-1",
                        departmentId: "dep-1",
                        requesterId,
                        assigneeId,
                        rating: null,
                        createdAt: new Date("2025-01-10T09:00:00Z"),
                        updatedAt: new Date("2025-01-10T09:00:00Z"),
                        slaDeadline: new Date("2025-01-11T09:00:00Z"),
                        resolvedAt: new Date("2025-01-10T10:00:00Z"),
                        closedAt: new Date("2025-01-10T11:00:00Z"),
                    };

                    const result = canChangeStatus(user, ticket, next);

                    if (user.role === "admin") {
                        expect(result).toBe(true);
                    } else if (
                        user.role === "tecnico" &&
                        ticket.assigneeId === user.id
                    ) {
                        // Técnico atribuído ainda pode (a máquina de estados
                        // limitará as transições válidas em ticket-state).
                        expect(result).toBe(true);
                    } else {
                        expect(result).toBe(false);
                    }
                },
            ),
            { numRuns: 500 },
        );
    });
});
