/**
 * Componente de domínio `TicketRow`.
 *
 * Diferentemente de outros componentes da camada `components/domain/`, o
 * `TicketRow` não renderiza um `<tr>` próprio: o `<tr>` já é gerenciado
 * pelo primitivo `DataTable`. Em vez disso, este módulo expõe a forma da
 * linha (`TicketRowData`) e uma factory (`ticketColumns`) que produz a
 * lista de `DataTableColumn<TicketRowData>` esperada pela tabela.
 *
 * A factory recebe as `policies` correntes (necessárias ao `SlaMeter`) e
 * possíveis flags futuras; isso mantém o conhecimento de domínio (qual
 * coluna existe, em que ordem, qual `sortKey`, qual `cell`) num único
 * lugar e permite que páginas como `/tickets` apenas componham:
 *
 *     <DataTable columns={ticketColumns({ policies })} rows={rows} ... />
 *
 * Cada célula compõe os componentes de domínio já existentes
 * (`StatusBadge`, `PriorityPill`, `CategoryChip`, `SlaMeter`) sem fetch
 * (R19.7) e usa apenas dados serializáveis em `TicketRowData`, para que
 * a página de listagem possa montar as linhas em um Server Component.
 *
 * Validates: R11, R19.4, R19.7
 */

import * as React from "react";

import { Avatar } from "@/components/ui/avatar";
import type { DataTableColumn } from "@/components/ui/data-table";
import { CategoryChip } from "@/components/domain/category-chip";
import { PriorityPill } from "@/components/domain/priority-pill";
import { SlaMeter } from "@/components/domain/sla-meter";
import { StatusBadge } from "@/components/domain/status-badge";
import { cn } from "@/lib/cn";
import { relTime } from "@/lib/format";
import type { Priority, SlaPolicy, TicketStatus } from "@/types/domain";

/**
 * Forma reduzida de `Ticket` esperada pelas células da tabela.
 *
 * O modelo de domínio (`Ticket`) referencia entidades por `id` (categoria,
 * solicitante, responsável). Como componentes de domínio não fazem fetch
 * (R19.7), a página de listagem é responsável por enriquecer cada linha
 * com os campos textuais derivados (`categoryLabel`, `requesterName`, etc.)
 * antes de passá-los ao `DataTable`.
 *
 * Mantemos a estrutura plana e serializável para que possa ser construída
 * em Server Components e atravessar a borda RSC sem ajuste manual.
 */
export interface TicketRowData {
    /** Identificador legível, p.ex. `"NVD-1043"`. */
    id: string;
    /** Título do ticket. */
    title: string;
    /** Status atual do ticket. */
    status: TicketStatus;
    /** Prioridade vigente. */
    priority: Priority;
    /** Nome do ícone Lucide aceito por `CategoryChip`. */
    categoryIcon: string;
    /** Rótulo principal da categoria (ex.: "Hardware"). */
    categoryLabel: string;
    /** Subtítulo opcional da categoria (ex.: "Periféricos"). */
    categorySub?: string;
    /** Nome do solicitante (já resolvido no servidor). */
    requesterName: string;
    /** Cor de fundo do avatar do solicitante (hex). */
    requesterAvatarColor?: string;
    /** Nome do responsável; `null` quando o ticket não está atribuído. */
    assigneeName: string | null;
    /** Cor de fundo do avatar do responsável (hex). */
    assigneeAvatarColor?: string;
    /** Departamento exibido sob o título como meta. */
    departmentLabel?: string;
    /** Prazo do SLA. */
    slaDeadline: Date;
    /** Data de criação. */
    createdAt: Date;
    /** Última atualização — usada na ordenação default. */
    updatedAt: Date;
}

/**
 * Opções de configuração da factory.
 *
 * `policies` é obrigatório porque o `SlaMeter` precisa resolver o total
 * de horas da prioridade do ticket para calcular `pctElapsed` e os
 * limiares `warn`/`crit`/`breached`.
 */
export interface TicketColumnsOptions {
    /** Políticas de SLA vigentes. */
    policies: SlaPolicy[];
    /** Tempo de referência para o `SlaMeter` (útil em testes). */
    now?: Date;
}

/**
 * Constrói a lista de colunas usada por `<DataTable<TicketRowData>>`.
 *
 * Ordem visual (alinhada à referência de `.example/screens-a.jsx`):
 *
 * 1. **id**         — `NVD-XXXX` em fonte mono.
 * 2. **title**      — título com truncamento + meta (departamento).
 * 3. **status**     — `StatusBadge`.
 * 4. **priority**   — `PriorityPill`.
 * 5. **category**   — `CategoryChip` com ícone + rótulo.
 * 6. **sla**        — `SlaMeter` (re-render somente em mudança de nível).
 * 7. **assignee**   — avatar + primeiro nome, ou `—` se ausente.
 * 8. **createdAt**  — tempo relativo em pt-BR.
 *
 * `sortKey` é definido apenas onde a comparação é estável e útil: id,
 * title, status, priority, slaDeadline e createdAt. As colunas de
 * categoria, responsável (texto) e meta visual não recebem `sortKey`
 * para evitar ordenações que confundem (ex.: ordenar por avatar).
 */
export function ticketColumns({
    policies,
    now,
}: TicketColumnsOptions): DataTableColumn<TicketRowData>[] {
    return [
        {
            id: "id",
            header: "ID",
            width: 100,
            sortKey: "id",
            cell: (row) => (
                <span className="font-mono text-xs text-(--ink-2)">
                    {row.id}
                </span>
            ),
        },
        {
            id: "title",
            header: "Título",
            sortKey: "title",
            cell: (row) => (
                <div className="min-w-0">
                    <div
                        className={cn(
                            "truncate text-sm font-medium text-(--ink)",
                        )}
                        title={row.title}
                    >
                        {row.title}
                    </div>
                    {row.departmentLabel ? (
                        <div className="truncate text-xs text-(--ink-3)">
                            {row.departmentLabel}
                        </div>
                    ) : null}
                </div>
            ),
        },
        {
            id: "status",
            header: "Status",
            width: 160,
            sortKey: "status",
            cell: (row) => <StatusBadge status={row.status} />,
        },
        {
            id: "priority",
            header: "Prioridade",
            width: 120,
            sortKey: "priority",
            cell: (row) => <PriorityPill priority={row.priority} />,
        },
        {
            id: "category",
            header: "Categoria",
            width: 240,
            cell: (row) => (
                <CategoryChip
                    icon={row.categoryIcon}
                    label={row.categoryLabel}
                    sub={row.categorySub}
                />
            ),
        },
        {
            id: "sla",
            header: "SLA",
            width: 180,
            sortKey: "slaDeadline",
            cell: (row) => (
                <SlaMeter
                    deadline={row.slaDeadline}
                    priority={row.priority}
                    status={row.status}
                    policies={policies}
                    now={now}
                />
            ),
        },
        {
            id: "assignee",
            header: "Atribuído",
            width: 140,
            cell: (row) =>
                row.assigneeName !== null ? (
                    <div className="flex items-center gap-2">
                        <Avatar
                            name={row.assigneeName}
                            color={row.assigneeAvatarColor}
                            size="sm"
                        />
                        <span className="truncate text-sm text-(--ink-2)">
                            {firstName(row.assigneeName)}
                        </span>
                    </div>
                ) : (
                    <span className="text-xs text-(--ink-4)">—</span>
                ),
        },
        {
            id: "createdAt",
            header: "Criado",
            width: 120,
            sortKey: "createdAt",
            cell: (row) => (
                <span className="text-xs text-(--ink-3)">
                    {relTime(row.createdAt, now)}
                </span>
            ),
        },
    ];
}

/**
 * Retorna apenas o primeiro nome ("João Silva" → "João"). Mantida local
 * por ser detalhe de apresentação da coluna de responsável; nomes vazios
 * caem em `—` no render acima e nunca chegam aqui.
 */
function firstName(fullName: string): string {
    const trimmed = fullName.trim();
    if (trimmed.length === 0) return trimmed;
    const first = trimmed.split(/\s+/)[0];
    return first ?? trimmed;
}
