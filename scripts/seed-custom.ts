/**
 * Seed customizado pedido pelo usuário (one-shot).
 *
 * Popula o banco recém-migrado com:
 *   - 3 departamentos (Fiscal, Contabilidade, TI)
 *   - 6 categorias padrão
 *   - 4 políticas de SLA padrão
 *   - 3 categorias de KB
 *   - 4 usuários:
 *       admin@navedesk.com         (admin, TI)            senha: Edz#7284@
 *       eduardo.lanzarin@navecon.net.br (tecnico, TI)    senha: Edz#7284@
 *       teste@navecon.net.br       (solicitante, Fiscal)  senha: teste123
 *       testedois@navecon.net.br   (solicitante, Contábil) senha: teste123
 *   - 1 ticket aberto pelo solicitante Fiscal (categoria "software")
 *   - 1 ticket aberto pelo solicitante Contábil (categoria "sistema")
 *
 * Não é idempotente: assume banco vazio (acabamos de recriar).
 */

import bcrypt from "bcrypt";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import {
    categories,
    departments,
    kbCategories,
    slaPolicies,
    ticketEvents,
    tickets,
    users,
} from "@/db/schema";
import { nextTicketId } from "@/lib/ticket-id";

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not set");
    }

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const db = drizzle(pool);

    try {
        await db.transaction(async (tx) => {
            // 1) Departamentos
            const deptRows = await tx
                .insert(departments)
                .values([
                    { name: "Fiscal" },
                    { name: "Contabilidade" },
                    { name: "TI" },
                ])
                .returning({ id: departments.id, name: departments.name });
            const deptByName = new Map(deptRows.map((d) => [d.name, d.id]));
            const fiscalId = deptByName.get("Fiscal")!;
            const contabilId = deptByName.get("Contabilidade")!;
            const tiId = deptByName.get("TI")!;

            // 2) Categorias de chamado
            await tx.insert(categories).values([
                { id: "hardware", label: "Hardware", sub: "Equipamentos físicos", icon: "monitor" },
                { id: "software", label: "Software", sub: "Aplicativos e licenças", icon: "package" },
                { id: "sistema", label: "Sistema", sub: "Sistemas internos", icon: "cog" },
                { id: "rede", label: "Rede", sub: "Conectividade e internet", icon: "wifi" },
                { id: "acesso", label: "Acesso", sub: "Permissões e credenciais", icon: "key" },
                { id: "email", label: "E-mail", sub: "Caixa postal e listas", icon: "mail" },
            ]);

            // 3) Políticas de SLA (horas)
            await tx.insert(slaPolicies).values([
                { priority: "baixa", hours: 48 },
                { priority: "media", hours: 24 },
                { priority: "alta", hours: 8 },
                { priority: "critica", hours: 2 },
            ]);

            // 4) Categorias de KB
            await tx.insert(kbCategories).values([
                { id: "acesso", label: "Acesso", icon: "key" },
                { id: "sistemas", label: "Sistemas", icon: "monitor" },
                { id: "geral", label: "Geral", icon: "info" },
            ]);

            // 5) Usuários (bcrypt cost 12 conforme R14.2)
            const adminHash = await bcrypt.hash("Edz#7284@", 12);
            const tecnicoHash = await bcrypt.hash("Edz#7284@", 12);
            const solicitanteHash = await bcrypt.hash("teste123", 12);

            const userRows = await tx
                .insert(users)
                .values([
                    {
                        email: "admin@navedesk.com",
                        name: "Administrador",
                        role: "admin",
                        departmentId: tiId,
                        passwordHash: adminHash,
                        avatarColor: "#5E5CE6",
                    },
                    {
                        email: "eduardo.lanzarin@navecon.net.br",
                        name: "Eduardo Lanzarin",
                        role: "tecnico",
                        departmentId: tiId,
                        passwordHash: tecnicoHash,
                        avatarColor: "#1473E6",
                    },
                    {
                        email: "teste@navecon.net.br",
                        name: "Teste",
                        role: "solicitante",
                        departmentId: fiscalId,
                        passwordHash: solicitanteHash,
                        avatarColor: "#30B257",
                    },
                    {
                        email: "testedois@navecon.net.br",
                        name: "Teste Dois",
                        role: "solicitante",
                        departmentId: contabilId,
                        passwordHash: solicitanteHash,
                        avatarColor: "#D98C00",
                    },
                ])
                .returning({
                    id: users.id,
                    email: users.email,
                });

            const userByEmail = new Map(userRows.map((u) => [u.email, u.id]));
            const sol1 = userByEmail.get("teste@navecon.net.br")!;
            const sol2 = userByEmail.get("testedois@navecon.net.br")!;

            // 6) Ticket do solicitante Fiscal
            const slaHours = 24; // prioridade media
            const now = new Date();
            const deadline = new Date(now.getTime() + slaHours * 3600 * 1000);

            const ticket1Id = await nextTicketId(
                "NVD",
                tx as unknown as Parameters<typeof nextTicketId>[1],
            );
            await tx.insert(tickets).values({
                id: ticket1Id,
                title: "Não consigo emitir nota fiscal",
                description:
                    "Ao tentar emitir uma NF-e o sistema retorna erro de schema XML. Já reiniciei o aplicativo e o problema persiste.",
                status: "aberto",
                priority: "media",
                categoryId: "software",
                departmentId: fiscalId,
                requesterId: sol1,
                slaDeadline: deadline,
            });
            await tx.insert(ticketEvents).values({
                ticketId: ticket1Id,
                type: "created",
                actorId: sol1,
            });

            // 7) Ticket do solicitante Contábil
            const ticket2Id = await nextTicketId(
                "NVD",
                tx as unknown as Parameters<typeof nextTicketId>[1],
            );
            await tx.insert(tickets).values({
                id: ticket2Id,
                title: "Sistema travando ao gerar balancete",
                description:
                    "Ao gerar o balancete do mês corrente o sistema fica sem responder por mais de 5 minutos. Aconteceu hoje pela manhã.",
                status: "aberto",
                priority: "alta",
                categoryId: "sistema",
                departmentId: contabilId,
                requesterId: sol2,
                slaDeadline: new Date(now.getTime() + 8 * 3600 * 1000),
            });
            await tx.insert(ticketEvents).values({
                ticketId: ticket2Id,
                type: "created",
                actorId: sol2,
            });

            console.log(`[seed-custom] tickets criados: ${ticket1Id}, ${ticket2Id}`);
        });

        // Verificação final
        const finalUsers = await db.select({ email: users.email, role: users.role }).from(users);
        const finalTickets = await db.select({ id: tickets.id, title: tickets.title }).from(tickets);
        console.log("[seed-custom] usuários:", finalUsers);
        console.log("[seed-custom] tickets:", finalTickets);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error("[seed-custom] failed:", err);
    process.exit(1);
});
