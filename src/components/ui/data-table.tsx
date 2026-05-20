/**
 * Primitivo `DataTable` genérico tipado.
 *
 * Tabela neutra usada para listar coleções de qualquer tipo `T` com
 * cabeçalhos opcionalmente ordenáveis, slot de vazio dedicado e estado
 * de carregamento por skeleton. Espelha o bloco `.t-wrap` / `.t` da
 * referência visual em `.example/styles.css`, mas adaptado ao padrão
 * shadcn/ui-style do projeto: tokens CSS (`--bg-elev`, `--bg-sunk`,
 * `--ink-3`, `--line`, `--r-3`), `cn` para composição de classes e
 * exposição de `className` para extensão pontual.
 *
 * Comportamento de ordenação:
 *
 * - Apenas colunas com `sortKey` (uma `keyof T`) ganham um cabeçalho
 *   clicável. As demais permanecem como `<th>` estático.
 * - O estado interno `sort` segue o ciclo
 *   `null → asc → desc → null` em cliques sucessivos no mesmo cabeçalho;
 *   clicar em uma coluna diferente reinicia em `asc`.
 * - A reordenação acontece sobre uma cópia rasa de `rows` usando uma
 *   função `compareValues` com tratamento seguro para `null`/`undefined`,
 *   `Date`, `number`, `string` (com `localeCompare` em pt-BR) e fallback
 *   por `String()`.
 *
 * Estados de exceção:
 *
 * - `loading=true` → renderiza 5 skeleton rows com `bg-(--bg-sunk)` +
 *   `animate-pulse`, preservando a quantidade de colunas para evitar
 *   layout shift.
 * - `rows.length === 0 && !loading` → renderiza o slot `empty` quando
 *   informado, ou cai no `EmptyState` padrão com mensagem em pt-BR.
 *
 * Acessibilidade:
 *
 * - Quando `onRowClick` é fornecido, cada `<tr>` recebe `role="button"`
 *   e `tabIndex=0`, e a tecla Enter / Espaço dispara o handler.
 * - Cabeçalhos ordenáveis são `<button type="button">` com `aria-sort`
 *   refletindo o estado atual (`ascending` | `descending` | `none`).
 *
 * Validates: R11.5, R19.3
 */

"use client";

import * as React from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export interface DataTableColumn<T> {
    /** Identificador estável da coluna (usado como `key` no React). */
    id: string;
    /** Conteúdo do cabeçalho (`React.ReactNode` para suportar ícones). */
    header: React.ReactNode;
    /** Largura sugerida; aceita número (em px) ou string (`"120px"`, `"20%"`). */
    width?: number | string;
    /** Renderizador da célula a partir do registro `T`. */
    cell: (row: T) => React.ReactNode;
    /**
     * Quando presente, marca a coluna como ordenável e indica qual
     * propriedade de `T` será usada na comparação.
     */
    sortKey?: keyof T;
}

export interface DataTableProps<T> {
    /** Definição das colunas. A ordem do array define a ordem visual. */
    columns: DataTableColumn<T>[];
    /** Linhas a renderizar. Pode estar vazia. */
    rows: T[];
    /** Função estável que extrai uma chave única para cada linha. */
    rowKey: (row: T) => string;
    /** Callback opcional disparado ao clicar em uma linha. */
    onRowClick?: (row: T) => void;
    /**
     * Conteúdo a exibir quando `rows.length === 0` e `loading=false`.
     * Quando ausente, cai no `EmptyState` padrão.
     */
    empty?: React.ReactNode;
    /** Mostra skeleton rows enquanto os dados carregam. */
    loading?: boolean;
    /** Classes adicionais aplicadas ao contêiner externo. */
    className?: string;
}

/** Direção de ordenação aceita pelo cabeçalho clicável. */
type SortDirection = "asc" | "desc";

/** Estado interno de ordenação; `null` significa "ordem original". */
interface SortState<T> {
    key: keyof T;
    direction: SortDirection;
}

/**
 * Compara dois valores arbitrários de forma segura, tratando `null` /
 * `undefined`, `Date`, `number` e `string`. O retorno segue a convenção
 * de `Array#sort`: negativo se `a < b`, positivo se `a > b`, zero se
 * iguais. Valores ausentes são empurrados para o fim, independente da
 * direção (consistente com a maior parte das tabelas de dados).
 */
function compareValues(a: unknown, b: unknown): number {
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime();
    }

    if (typeof a === "number" && typeof b === "number") {
        // Trata NaN como ausente para evitar ordenação inconsistente.
        if (Number.isNaN(a) && Number.isNaN(b)) return 0;
        if (Number.isNaN(a)) return 1;
        if (Number.isNaN(b)) return -1;
        return a - b;
    }

    if (typeof a === "boolean" && typeof b === "boolean") {
        return a === b ? 0 : a ? 1 : -1;
    }

    if (typeof a === "string" && typeof b === "string") {
        return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    }

    // Fallback: coerção para string com locale pt-BR.
    return String(a).localeCompare(String(b), "pt-BR", {
        sensitivity: "base",
    });
}

/**
 * Componente `DataTable<T>`.
 *
 * Genérico em `T` para que o consumidor obtenha tipagem precisa em
 * `cell(row)`, `rowKey(row)`, `onRowClick(row)` e `sortKey`. Não realiza
 * fetch nem conhece o domínio; é puramente apresentacional, alinhado ao
 * R19.7 ("componentes de domínio recebem dados via props").
 */
export function DataTable<T>({
    columns,
    rows,
    rowKey,
    onRowClick,
    empty,
    loading = false,
    className,
}: DataTableProps<T>) {
    const [sort, setSort] = React.useState<SortState<T> | null>(null);

    /**
     * Avança o ciclo de ordenação no cabeçalho clicado:
     * `null → asc → desc → null`. Trocar de coluna reinicia em `asc`.
     */
    const toggleSort = React.useCallback((key: keyof T) => {
        setSort((prev) => {
            if (prev === null || prev.key !== key) {
                return { key, direction: "asc" };
            }
            if (prev.direction === "asc") {
                return { key, direction: "desc" };
            }
            return null;
        });
    }, []);

    /**
     * Linhas exibidas: ordenadas conforme `sort`, ou na ordem original
     * quando `sort` é `null`. Usa cópia rasa para não mutar `rows`.
     */
    const displayRows = React.useMemo<T[]>(() => {
        if (sort === null) return rows;
        const { key, direction } = sort;
        const sorted = [...rows].sort((a, b) =>
            compareValues(a[key], b[key]),
        );
        return direction === "desc" ? sorted.reverse() : sorted;
    }, [rows, sort]);

    const colCount = columns.length;

    return (
        <div
            className={cn(
                "overflow-x-auto rounded-(--r-4) border border-hairline border-(--line) bg-(--bg-elev) shadow-(--sh-1)",
                className,
            )}
        >
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="bg-black/[0.02] text-(--ink-3)">
                        {columns.map((col) => {
                            const widthStyle: React.CSSProperties | undefined =
                                col.width !== undefined
                                    ? {
                                        width: col.width,
                                        minWidth: col.width,
                                    }
                                    : undefined;
                            const isSortable = col.sortKey !== undefined;
                            const isActive =
                                isSortable &&
                                sort !== null &&
                                sort.key === col.sortKey;
                            const ariaSort: React.AriaAttributes["aria-sort"] =
                                !isSortable
                                    ? undefined
                                    : isActive
                                        ? sort.direction === "asc"
                                            ? "ascending"
                                            : "descending"
                                        : "none";

                            return (
                                <th
                                    key={col.id}
                                    scope="col"
                                    style={widthStyle}
                                    aria-sort={ariaSort}
                                    className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] border-b border-hairline border-(--line)"
                                >
                                    {isSortable ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                toggleSort(
                                                    col.sortKey as keyof T,
                                                )
                                            }
                                            className={cn(
                                                "inline-flex items-center gap-1.5 rounded-(--r-2) -mx-1 px-1 py-0.5",
                                                "transition-colors hover:text-(--ink)",
                                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                                                "focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-sunk)",
                                                isActive && "text-(--ink)",
                                            )}
                                        >
                                            <span>{col.header}</span>
                                            <SortIndicator
                                                active={isActive}
                                                direction={
                                                    isActive
                                                        ? sort.direction
                                                        : null
                                                }
                                            />
                                        </button>
                                    ) : (
                                        col.header
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <SkeletonRows columns={columns} rowCount={5} />
                    ) : displayRows.length === 0 ? (
                        <tr>
                            <td colSpan={colCount} className="p-0">
                                {empty ?? (
                                    <EmptyState
                                        title="Nenhum resultado"
                                        description="Tente ajustar os filtros ou limpar a busca."
                                    />
                                )}
                            </td>
                        </tr>
                    ) : (
                        displayRows.map((row) => {
                            const key = rowKey(row);
                            const clickable = onRowClick !== undefined;

                            return (
                                <tr
                                    key={key}
                                    role={clickable ? "button" : undefined}
                                    tabIndex={clickable ? 0 : undefined}
                                    onClick={
                                        clickable
                                            ? () => onRowClick?.(row)
                                            : undefined
                                    }
                                    onKeyDown={
                                        clickable
                                            ? (event) => {
                                                if (
                                                    event.key === "Enter" ||
                                                    event.key === " "
                                                ) {
                                                    event.preventDefault();
                                                    onRowClick?.(row);
                                                }
                                            }
                                            : undefined
                                    }
                                    className={cn(
                                        "transition-colors duration-[var(--dur-fast)]",
                                        clickable &&
                                        "cursor-pointer hover:bg-black/[0.02] focus-visible:bg-black/[0.02] focus-visible:outline-none",
                                    )}
                                >
                                    {columns.map((col) => (
                                        <td
                                            key={col.id}
                                            className="px-4 py-3 text-sm border-t border-hairline border-(--line-soft) align-middle text-(--ink)"
                                        >
                                            {col.cell(row)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Indicador visual da direção de ordenação. Renderiza um chevron
 * apontando para cima (`asc`) ou para baixo (`desc`); permanece em tom
 * `--ink-4` quando a coluna não é a ativa, oferecendo dica sutil de
 * que o cabeçalho é clicável.
 */
function SortIndicator({
    active,
    direction,
}: {
    active: boolean;
    direction: SortDirection | null;
}) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={cn(
                "h-3 w-3 shrink-0 transition-colors",
                active ? "text-(--ink)" : "text-(--ink-4)",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {direction === "desc" ? (
                <path d="M3 5l3 3 3-3" />
            ) : (
                <path d="M3 7l3-3 3 3" />
            )}
        </svg>
    );
}

/**
 * Renderiza linhas-skeleton enquanto `loading=true`. Cada célula recebe
 * uma barra `bg-(--bg-sunk)` com `animate-pulse`. A largura varia por
 * coluna para parecer com conteúdo real, sem depender do domínio.
 */
function SkeletonRows<T>({
    columns,
    rowCount,
}: {
    columns: DataTableColumn<T>[];
    rowCount: number;
}) {
    return (
        <>
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
                <tr key={`skeleton-${rowIdx}`}>
                    {columns.map((col, colIdx) => (
                        <td
                            key={col.id}
                            className="px-4 py-3 border-t border-(--line)"
                        >
                            <div
                                aria-hidden="true"
                                className="h-3 rounded-(--r-1) bg-(--bg-sunk) animate-pulse"
                                style={{
                                    width:
                                        colIdx === 0
                                            ? "40%"
                                            : colIdx === columns.length - 1
                                                ? "50%"
                                                : "70%",
                                }}
                            />
                            <span className="sr-only">Carregando…</span>
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}
