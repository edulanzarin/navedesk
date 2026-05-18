/**
 * `TicketsDataTable` — wrapper Client Component em torno do
 * primitivo `DataTable<TicketRowData>`.
 *
 * Por que existir? `DataTable` é um Client Component genérico e suas
 * colunas (`columns`) carregam a função `cell: (row) => ReactNode` —
 * funções não atravessam a fronteira RSC. Construir o `columns` (e o
 * `rowKey`) dentro de um Client Component resolve isso sem expor o
 * `DataTable` a fetch de domínio.
 *
 * Contrato:
 *
 * - O Server Component prepara `rows: TicketRowData[]` (já com
 *   categoria, departamento, solicitante, responsável resolvidos) e
 *   `policies: SlaPolicy[]`. Ambos são serializáveis e atravessam o
 *   wire RSC sem ajuste manual.
 * - Este wrapper monta as colunas localmente via `ticketColumns` e
 *   passa para o `DataTable`. Mantém o domínio (`StatusBadge`,
 *   `PriorityPill`, `SlaMeter`, …) co-localizado com a tabela e isola
 *   as funções não-serializáveis no cliente.
 *
 * Pretende ser reutilizado por `/tickets`, `/tickets/atribuidos` e
 * qualquer outra listagem de tickets futura — basta passar as linhas
 * já enriquecidas e as políticas vigentes.
 *
 * Validates: R11.5, R19.4, R19.7
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { DataTable } from "@/components/ui/data-table";
import {
    ticketColumns,
    type TicketRowData,
} from "@/components/domain/ticket-row";
import type { SlaPolicy } from "@/types/domain";

export interface TicketsDataTableProps {
    /** Linhas já enriquecidas pelo Server Component. */
    rows: TicketRowData[];
    /** Políticas de SLA vigentes (necessárias ao `SlaMeter`). */
    policies: SlaPolicy[];
}

/** Extrator estável de chave; mantido fora do componente para não recriar a função a cada render. */
function rowKey(row: TicketRowData): string {
    return row.id;
}

export function TicketsDataTable({
    rows,
    policies,
}: TicketsDataTableProps): React.ReactElement {
    const router = useRouter();

    // `useMemo` recompõe as colunas apenas quando `policies` muda —
    // navegações com filtros novos preservam a referência, evitando
    // re-renders desnecessários do `DataTable`.
    const columns = React.useMemo(
        () => ticketColumns({ policies }),
        [policies],
    );

    /**
     * Click na linha → abre o detalhe do ticket. `router.push` mantém
     * a navegação no client; o `<DataTable>` já cuida de Enter/Space
     * (`role="button"` + `tabIndex=0`) para acessibilidade por teclado.
     *
     * Mantemos a função estável via `useCallback` para que o memo do
     * `DataTable` (caso seja adicionado no futuro) consiga reconciliar
     * sem disparar re-renders supérfluos.
     */
    const handleRowClick = React.useCallback(
        (row: TicketRowData) => {
            router.push(`/tickets/${row.id}`);
        },
        [router],
    );

    return (
        <DataTable<TicketRowData>
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            onRowClick={handleRowClick}
        />
    );
}
