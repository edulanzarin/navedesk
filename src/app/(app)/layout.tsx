/**
 * Layout autenticado do NaveDesk.
 *
 * Server Component raiz do grupo de rotas `(app)`. Responsabilidades:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente. Defesa em profundidade sobre `src/middleware.ts`,
 *    que já bloqueia visitantes anônimos: o middleware roda em edge e
 *    pode ser ignorado em rotas excluídas do `matcher`; este redirect
 *    explícito garante que nenhuma página dentro de `(app)` execute
 *    sem `session.user` populado (R1.1, R1.7).
 *
 * 2. **Calcular os contadores da `Sidebar`** (`open`, `assigned`,
 *    `unassigned`) com queries `count()` paralelas escopadas por
 *    papel (R2.4). Para o solicitante, `open` cobre apenas seus
 *    próprios tickets em status `aberto`; `assigned` e `unassigned`
 *    são forçados a 0 porque os itens correspondentes não aparecem
 *    no menu desse papel — calcular seria desperdício. Para
 *    técnico/admin, `assigned` conta tickets cujo `assigneeId` é o
 *    usuário corrente (excluindo `fechado`) e `unassigned` conta os
 *    sem responsável também excluindo `fechado`, refletindo a
 *    intenção dos atalhos "Atribuídos a mim" e "Sem responsável" da
 *    `Sidebar`.
 *
 * 3. **Compor o esqueleto visual** com `Sidebar` à esquerda e, à
 *    direita, `Topbar` no topo + `<main>` rolável ocupando o restante.
 *    O título da `Topbar` permanece genérico ("NaveDesk") porque cada
 *    página renderiza seu próprio `PageHeader` (R19.4). O slot `actions`
 *    é deixado vazio por enquanto; tarefas futuras podem injetar ações
 *    contextuais via `useSelectedLayoutSegment()` se necessário.
 *
 * O componente é `async` — os contadores são lidos durante o render do
 * RSC, sem hidratação client. `Sidebar` e `Topbar` são Client Components
 * (precisam de `usePathname` e Radix Dropdown respectivamente), mas o
 * shell em si não fica preso ao client por causa disso: o Next.js
 * permite Server Components passarem props serializáveis a Client
 * Components, e ambos só recebem dados (objeto `user`, números,
 * referência da Server Action).
 *
 * Validates: R1, R2.
 */

import { redirect } from "next/navigation";
import { and, count, eq, isNull, ne, type SQL } from "drizzle-orm";

import { logoutAction } from "@/actions/auth";
import { Sidebar, type SidebarCounts } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { db } from "@/db/client";
import { tickets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { BRAND_NAME } from "@/lib/brand";
import type { SessionUser } from "@/types/domain";

/**
 * Conta linhas em `tickets` com a composição AND das condições
 * informadas. Encapsula o padrão `select({ value: count() })...` do
 * Drizzle e cuida de descartar `undefined` (sem condição) e de tratar
 * o caso degenerado de `count()` retornando `null`.
 */
async function countTickets(
    ...conditions: Array<SQL | undefined>
): Promise<number> {
    const filtered = conditions.filter((c): c is SQL => c !== undefined);
    const where =
        filtered.length === 0
            ? undefined
            : filtered.length === 1
                ? filtered[0]
                : and(...filtered);

    const query = db.select({ value: count() }).from(tickets);
    const rows = where ? await query.where(where) : await query;
    return rows[0]?.value ?? 0;
}

/**
 * Calcula os contadores exibidos na `Sidebar` para o usuário corrente.
 *
 * As três contagens são independentes e rodam em paralelo via
 * `Promise.all` para reduzir a latência do TTFB do layout. O escopo
 * por papel garante que solicitantes vejam apenas seus próprios
 * tickets em "Tickets" e que os contadores de itens ocultos do menu
 * não consumam ciclos de banco à toa.
 */
async function getSidebarCounts(user: SessionUser): Promise<SidebarCounts> {
    const isRequester = user.role === "solicitante";

    // Filtro implícito por solicitante (R2.4). `undefined` para
    // tecnico/admin deixa a contagem irrestrita, o que é o comportamento
    // esperado para os atalhos globais de tickets.
    const requesterScope: SQL | undefined = isRequester
        ? eq(tickets.requesterId, user.id)
        : undefined;

    const openCountP = countTickets(eq(tickets.status, "aberto"), requesterScope);

    // Para o solicitante esses dois itens não aparecem na Sidebar;
    // poupamos a query e fixamos 0.
    const assignedCountP: Promise<number> = isRequester
        ? Promise.resolve(0)
        : countTickets(
            eq(tickets.assigneeId, user.id),
            ne(tickets.status, "fechado"),
        );

    const unassignedCountP: Promise<number> = isRequester
        ? Promise.resolve(0)
        : countTickets(isNull(tickets.assigneeId), ne(tickets.status, "fechado"));

    const [open, assigned, unassigned] = await Promise.all([
        openCountP,
        assignedCountP,
        unassignedCountP,
    ]);

    return { open, assigned, unassigned };
}

/**
 * Layout do grupo `(app)`. Renderizado pelo Next.js para qualquer rota
 * autenticada do produto.
 *
 * Estrutura:
 *
 * ```
 * ┌──────────┬──────────────────────────────┐
 * │          │ Topbar                        │
 * │ Sidebar  ├──────────────────────────────┤
 * │          │ <main> {children} </main>     │
 * └──────────┴──────────────────────────────┘
 * ```
 *
 * - `flex h-screen` no container raiz fixa o shell à viewport,
 *   permitindo que `<main>` role independentemente da `Sidebar` e da
 *   `Topbar`.
 * - `min-w-0` na coluna direita evita que conteúdos largos
 *   (tabelas, mensagens) empurrem a `Sidebar` em viewports estreitos.
 * - `min-h-0` em `<main>` é necessário para que `overflow-auto`
 *   funcione dentro de um filho de flex column.
 */
export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }

    const user = session.user satisfies SessionUser;
    const counts = await getSidebarCounts(user);

    return (
        <div className="flex h-screen bg-(--bg)">
            <Sidebar user={user} counts={counts} />
            <div className="flex min-w-0 flex-1 flex-col">
                <Topbar
                    title={BRAND_NAME}
                    user={user}
                    signOutAction={logoutAction}
                />
                <main className="min-h-0 flex-1 overflow-auto p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}
