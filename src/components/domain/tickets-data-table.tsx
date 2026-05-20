/**
 * `TicketsDataTable` — wrapper Client Component em torno do
 * primitivo `DataTable<TicketRowData>` com seleção em lote opcional.
 *
 * Quando `bulkActions` é fornecido (apenas admin via prop), prepende
 * uma coluna de checkboxes e renderiza uma toolbar contextual que
 * aparece quando há linhas selecionadas. As ações são entregues via
 * Server Action e refrescam a página em sucesso.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Tag, UserCog, Building2, Trash2, X } from "lucide-react";

import { bulkUpdateTicketsAction } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownLabel,
    DropdownSeparator,
    DropdownTrigger,
} from "@/components/ui/dropdown";
import { toast } from "@/components/ui/use-toast";
import {
    ticketColumns,
    type TicketRowData,
} from "@/components/domain/ticket-row";
import { cn } from "@/lib/cn";
import { PRIORITIES, PRIORITY_LABELS_PT } from "@/lib/constants";
import { getErrorMessage } from "@/lib/error-messages";
import type { Priority, SlaPolicy } from "@/types/domain";

export interface TicketsBulkOption {
    id: string;
    label: string;
}

export interface TicketsDataTableProps {
    /** Linhas já enriquecidas pelo Server Component. */
    rows: TicketRowData[];
    /** Políticas de SLA vigentes (necessárias ao `SlaMeter`). */
    policies: SlaPolicy[];
    /**
     * Quando fornecido, ativa a coluna de checkboxes e expõe a toolbar
     * de ações em lote (apenas admin recebe esse prop). Categorias e
     * departamentos vêm pré-resolvidos para popular os menus.
     */
    bulkContext?: {
        categories: TicketsBulkOption[];
        departments: TicketsBulkOption[];
    };
}

function rowKey(row: TicketRowData): string {
    return row.id;
}

export function TicketsDataTable({
    rows,
    policies,
    bulkContext,
}: TicketsDataTableProps): React.ReactElement {
    const router = useRouter();
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [isPending, startTransition] = React.useTransition();

    // Reseta seleção quando as linhas mudam (paginação, filtros).
    React.useEffect(() => {
        setSelected(new Set());
    }, [rows]);

    const allOnPageSelected =
        rows.length > 0 && rows.every((r) => selected.has(r.id));

    function toggleAll(): void {
        setSelected((prev) => {
            if (allOnPageSelected) return new Set();
            const next = new Set(prev);
            for (const r of rows) next.add(r.id);
            return next;
        });
    }

    function toggleOne(id: string): void {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    const baseColumns = React.useMemo(
        () => ticketColumns({ policies }),
        [policies],
    );

    const columns = React.useMemo<DataTableColumn<TicketRowData>[]>(() => {
        if (!bulkContext) return baseColumns;
        // Coluna de checkbox prepended.
        const checkboxCol: DataTableColumn<TicketRowData> = {
            id: "select",
            header: (
                <input
                    type="checkbox"
                    aria-label="Selecionar todos da página"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    onClick={(e) => e.stopPropagation()}
                    className="size-4 rounded border-(--line) text-(--accent) focus-visible:ring-2 focus-visible:ring-(--accent)"
                />
            ),
            width: 40,
            cell: (row) => (
                <input
                    type="checkbox"
                    aria-label={`Selecionar ${row.id}`}
                    checked={selected.has(row.id)}
                    onChange={(e) => {
                        e.stopPropagation();
                        toggleOne(row.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="size-4 rounded border-(--line) text-(--accent) focus-visible:ring-2 focus-visible:ring-(--accent)"
                />
            ),
        };
        return [checkboxCol, ...baseColumns];
        // `selected` muda muito (a cada toggle), então recriamos as
        // colunas — DataTable é leve o bastante pra suportar.
    }, [bulkContext, baseColumns, allOnPageSelected, selected]);

    const handleRowClick = React.useCallback(
        (row: TicketRowData) => {
            router.push(`/tickets/${row.id}`);
        },
        [router],
    );

    async function applyBulk(patch: {
        categoryId?: string;
        departmentId?: string;
        priority?: Priority;
    }): Promise<void> {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        startTransition(async () => {
            const result = await bulkUpdateTicketsAction(ids, patch);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: `${result.data.updated} ticket(s) atualizado(s)`,
                    description:
                        result.data.failed > 0
                            ? `${result.data.failed} falharam.`
                            : undefined,
                });
                setSelected(new Set());
                router.refresh();
            } else {
                toast({
                    variant: "error",
                    title: "Falha na ação em lote",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    return (
        <div className="flex flex-col gap-3">
            {bulkContext && selected.size > 0 ? (
                <div
                    className={cn(
                        "flex flex-wrap items-center gap-3 rounded-(--r-3) border border-hairline border-(--accent)",
                        "bg-(--accent-soft) px-3 py-2 text-sm",
                    )}
                >
                    <span className="font-medium text-(--accent)">
                        {selected.size} selecionado(s)
                    </span>
                    <span className="flex-1" />

                    <Dropdown>
                        <DropdownTrigger asChild>
                            <Button
                                size="sm"
                                variant="default"
                                icon={<Tag />}
                                disabled={isPending}
                            >
                                Categoria
                            </Button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                            <DropdownLabel>Mover para</DropdownLabel>
                            <DropdownSeparator />
                            {bulkContext.categories.map((c) => (
                                <DropdownItem
                                    key={c.id}
                                    onSelect={() =>
                                        void applyBulk({ categoryId: c.id })
                                    }
                                >
                                    {c.label}
                                </DropdownItem>
                            ))}
                        </DropdownContent>
                    </Dropdown>

                    <Dropdown>
                        <DropdownTrigger asChild>
                            <Button
                                size="sm"
                                variant="default"
                                icon={<Building2 />}
                                disabled={isPending}
                            >
                                Departamento
                            </Button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                            <DropdownLabel>Mover para</DropdownLabel>
                            <DropdownSeparator />
                            {bulkContext.departments.map((d) => (
                                <DropdownItem
                                    key={d.id}
                                    onSelect={() =>
                                        void applyBulk({ departmentId: d.id })
                                    }
                                >
                                    {d.label}
                                </DropdownItem>
                            ))}
                        </DropdownContent>
                    </Dropdown>

                    <Dropdown>
                        <DropdownTrigger asChild>
                            <Button
                                size="sm"
                                variant="default"
                                icon={<UserCog />}
                                disabled={isPending}
                            >
                                Prioridade
                            </Button>
                        </DropdownTrigger>
                        <DropdownContent align="end">
                            <DropdownLabel>Definir como</DropdownLabel>
                            <DropdownSeparator />
                            {PRIORITIES.map((p) => (
                                <DropdownItem
                                    key={p}
                                    onSelect={() =>
                                        void applyBulk({ priority: p })
                                    }
                                >
                                    {PRIORITY_LABELS_PT[p]}
                                </DropdownItem>
                            ))}
                        </DropdownContent>
                    </Dropdown>

                    <Button
                        size="sm"
                        variant="ghost"
                        icon={<X />}
                        onClick={() => setSelected(new Set())}
                        disabled={isPending}
                    >
                        Limpar seleção
                    </Button>
                </div>
            ) : null}

            <DataTable<TicketRowData>
                columns={columns}
                rows={rows}
                rowKey={rowKey}
                onRowClick={handleRowClick}
            />

            {/* trash icon imported but only used in dropdown items in
                future expansions */}
            <span aria-hidden="true" className="hidden">
                <Trash2 />
            </span>
        </div>
    );
}
