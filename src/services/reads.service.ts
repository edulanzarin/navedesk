/**
 * Reads service — leituras estáveis com cache TTL 60s (R15.3).
 *
 * Concentra as três leituras "frias" do domínio que praticamente só mudam
 * por ações administrativas: políticas de SLA, categorias e departamentos.
 * Cada uma é resolvida pelo `stableReadsCache` antes de ir ao banco; em
 * caso de miss, a função correspondente preenche o cache antes de retornar.
 *
 * Pareamento com `services/admin.service.ts` (task 16.7):
 *
 * - `updateSlaPolicy` invalida `STABLE_READ_KEYS.slaPolicies` (R15.3).
 * - `createCategory` / `deactivateCategory` / `deleteCategory` invalidam
 *   `STABLE_READ_KEYS.categories` (R15).
 * - Mutações em `departments` (caso surjam) invalidam
 *   `STABLE_READ_KEYS.departments`.
 *
 * Helpers `invalidate*` ficam expostos para que callers fora do
 * admin.service (por exemplo, scripts de seed) também consigam forçar
 * refresh sem importar diretamente o módulo `lib/cache`.
 *
 * Validates: R15.3.
 */

import { db } from "@/db/client";
import { categories, departments, slaPolicies } from "@/db/schema";
import { stableReadsCache } from "@/lib/cache";
import type { SlaPolicy } from "@/types/domain";

/**
 * Chaves estáveis usadas no `stableReadsCache`. Centralizá-las aqui evita
 * desalinhamento entre quem grava e quem invalida.
 */
export const STABLE_READ_KEYS = {
    slaPolicies: "sla:policies",
    categories: "taxonomy:categories",
    departments: "taxonomy:departments",
} as const;

/**
 * Categoria de chamado conforme `categories` no schema (R15.4).
 *
 * Reproduzimos o shape da tabela em vez de reusar o tipo Drizzle para
 * manter a camada de serviço como contrato estável: mudanças no schema
 * (por exemplo, novas colunas) ficam contidas até decidirmos expô-las.
 */
export interface CategoryRow {
    id: string;
    label: string;
    sub: string;
    icon: string;
    active: boolean;
}

/**
 * Departamento conforme `departments` no schema.
 */
export interface DepartmentRow {
    id: string;
    name: string;
}

/**
 * Retorna todas as políticas de SLA vigentes (R6.1, R15.1).
 *
 * Lê do cache quando disponível; em miss, consulta `sla_policies` e
 * popula o cache com TTL default (60s). O retorno é mapeado para
 * `SlaPolicy` (sem `updatedAt`) para preservar o desacoplamento entre
 * a camada de domínio e o schema Drizzle.
 *
 * Importante: esta função usa a `db` global. Operações que precisam ler
 * as políticas dentro de uma transação (por exemplo, `tickets.service`
 * ao criar um ticket) devem continuar consultando `slaPolicies`
 * diretamente pelo executor da transação para garantir snapshot
 * consistente — o cache é ideal para reads de UI e Server Actions de
 * leitura, não para o caminho transacional.
 */
export async function getAllSlaPolicies(): Promise<SlaPolicy[]> {
    const cached = stableReadsCache.get<SlaPolicy[]>(
        STABLE_READ_KEYS.slaPolicies,
    );
    if (cached) return cached;

    const rows = await db.select().from(slaPolicies);
    const policies: SlaPolicy[] = rows.map((row) => ({
        priority: row.priority,
        hours: row.hours,
    }));
    stableReadsCache.set(STABLE_READ_KEYS.slaPolicies, policies);
    return policies;
}

/**
 * Lista todas as categorias de chamado, ativas e inativas (R15.4).
 *
 * Mantemos as inativas no payload porque a tela `/admin/categorias`
 * precisa mostrá-las, e os formulários de criação de ticket filtram
 * `active=true` no consumidor (R15.6). Devolver tudo num único cache
 * evita manter duas chaves para subsets do mesmo conjunto.
 */
export async function listCategories(): Promise<CategoryRow[]> {
    const cached = stableReadsCache.get<CategoryRow[]>(
        STABLE_READ_KEYS.categories,
    );
    if (cached) return cached;

    const rows = await db.select().from(categories);
    stableReadsCache.set(STABLE_READ_KEYS.categories, rows);
    return rows;
}

/**
 * Lista todos os departamentos cadastrados.
 *
 * Departamentos são uma taxonomia simples (apenas `id` + `name`) e a UI
 * normalmente os exibe ordenados pelo nome. A ordenação é deixada para
 * o consumidor para que o cache seja agnóstico do uso.
 */
export async function listDepartments(): Promise<DepartmentRow[]> {
    const cached = stableReadsCache.get<DepartmentRow[]>(
        STABLE_READ_KEYS.departments,
    );
    if (cached) return cached;

    const rows = await db.select().from(departments);
    stableReadsCache.set(STABLE_READ_KEYS.departments, rows);
    return rows;
}

/**
 * Invalida o cache de políticas de SLA. Chamado por `admin.service` após
 * `updateSlaPolicy` (R15.3).
 */
export function invalidateSlaPoliciesCache(): void {
    stableReadsCache.invalidate(STABLE_READ_KEYS.slaPolicies);
}

/**
 * Invalida o cache de categorias. Chamado após criar, desativar ou
 * excluir uma categoria (R15.5–R15.7).
 */
export function invalidateCategoriesCache(): void {
    stableReadsCache.invalidate(STABLE_READ_KEYS.categories);
}

/**
 * Invalida o cache de departamentos. Reservado para futuras Server
 * Actions de gestão de departamentos.
 */
export function invalidateDepartmentsCache(): void {
    stableReadsCache.invalidate(STABLE_READ_KEYS.departments);
}
