/**
 * `TicketsFilterBar` — Client Component que controla os filtros da
 * lista de tickets (`/tickets`) projetando seu estado diretamente na
 * query string.
 *
 * Responsabilidades
 *
 * 1. Ler os filtros correntes a partir de `useSearchParams()` e
 *    apresentar `Select`s coerentes com o que o servidor já entende em
 *    `tickets/page.tsx`: `status`, `priority`, `categoryId`,
 *    `departmentId`, `assignee` (`me`/`none`/uuid), busca textual `q`,
 *    `sort` e `dir`.
 * 2. Atualizar a URL com `router.replace(..., { scroll: false })` a cada
 *    mudança de filtro. Manter o estado na URL preserva os filtros em
 *    refresh, navegação e compartilhamento (R11.2, R12).
 * 3. Resetar o `cursor` em qualquer alteração de filtro/sort — manter
 *    um cursor antigo após mudar o conjunto de resultados leva a
 *    páginas inválidas; o repositório já tolera cursor ausente
 *    listando a primeira página.
 * 4. Debouncer (~300ms) o input de busca textual para evitar disparar
 *    uma navegação por tecla pressionada.
 * 5. Expor um botão "Limpar filtros" que volta a URL para `/tickets`
 *    cru, restaurando ordenação default e removendo todos os filtros.
 *
 * Decisões de UX
 *
 * - Cada `Select` usa o sentinel `__all__` para representar "Todos",
 *   porque `@radix-ui/react-select` proíbe `value=""` em `SelectItem`.
 *   O sentinel só vive no cliente; ao serializar para URL, ele vira
 *   ausência da chave (`sp.delete(key)`).
 * - O filtro de responsável é exposto apenas para `tecnico`/`admin`
 *   via `canFilterByAssignee`. Solicitantes têm `requesterId`
 *   implícito no servidor (R11.4) e o domínio não permite que vejam
 *   tickets de outros, então o controle seria ruidoso.
 * - Categorias inativas continuam aparecendo na lista para que uma URL
 *   antiga apontando para `categoryId=<inativa>` mantenha coerência
 *   visual com a barra. São marcadas com sufixo `(inativa)`.
 *
 * Sincronização do input de busca
 *
 * O input de texto é controlado localmente para que o usuário possa
 * digitar sem latência. Um par de efeitos coordena estado local ↔ URL:
 *
 * - Após o debounce, o trimmed do input é gravado em `lastSentRef` e
 *   empurrado para a URL. Quando o `useSearchParams()` reflete o novo
 *   `q`, o efeito de sincronização compara contra `lastSentRef` e
 *   identifica a mudança como "nossa", ignorando o re-sync. Isso evita
 *   sobrescrever o que o usuário ainda está digitando.
 * - Mudanças externas de URL (botão Limpar, navegação back/forward do
 *   navegador) chegam com `currentQ !== lastSentRef`, e o efeito
 *   sincroniza o input para refletir a URL.
 *
 * Validates: R11.2.
 */

"use client";

import * as React from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    PRIORITIES,
    PRIORITY_LABELS_PT,
    STATUSES,
    STATUS_LABELS_PT,
    type Priority,
    type TicketStatus,
} from "@/lib/constants";

/** Sentinel para "Todos" — Radix Select não aceita value vazio. */
const ALL = "__all__";

/** Tempo de debounce do input de busca, em milissegundos. */
const SEARCH_DEBOUNCE_MS = 300;

/** Defaults do servidor — usados para detectar "filtro ativo". */
const DEFAULT_SORT = "updatedAt";
const DEFAULT_DIR = "desc";

/** Opções aceitas pelo `sort` no repositório (alinhadas ao RSC). */
const SORT_OPTIONS = [
    { value: "updatedAt", label: "Atualização" },
    { value: "createdAt", label: "Criação" },
    { value: "priority", label: "Prioridade" },
    { value: "slaDeadline", label: "Prazo SLA" },
] as const;

/** Direções de ordenação em pt-BR. */
const DIR_OPTIONS = [
    { value: "desc", label: "Decrescente" },
    { value: "asc", label: "Crescente" },
] as const;

/** Atalhos de filtro de responsável expostos a tecnico/admin. */
const ASSIGNEE_OPTIONS = [
    { value: ALL, label: "Todos" },
    { value: "me", label: "Atribuídos a mim" },
    { value: "none", label: "Sem responsável" },
] as const;

/**
 * Forma reduzida da categoria suficiente para popular o `Select`. O
 * componente recebe ativas e inativas (mesmo conjunto consumido pelo
 * RSC) para que URLs antigas continuem renderizando o rótulo correto.
 */
export interface TicketsFilterBarCategory {
    id: string;
    label: string;
    /** Quando `false`, o item recebe sufixo "(inativa)" no rótulo. */
    active?: boolean;
}

/** Forma reduzida do departamento para o `Select`. */
export interface TicketsFilterBarDepartment {
    id: string;
    name: string;
}

export interface TicketsFilterBarProps {
    categories: TicketsFilterBarCategory[];
    departments: TicketsFilterBarDepartment[];
    /**
     * Quando `true`, exibe o filtro de responsável (atalhos `me` /
     * `none`). Default `false` — adequado para solicitantes, que não
     * enxergam tickets atribuídos a outros (R11.4).
     */
    canFilterByAssignee?: boolean;
}

/**
 * Lê uma chave `searchParams` retornando `string | undefined`. Centraliza
 * o `??` para reduzir ruído nos `currentX`.
 */
function readParam(
    sp: URLSearchParams | ReturnType<typeof useSearchParams>,
    key: string,
): string | undefined {
    const value = sp.get(key);
    return value === null || value.length === 0 ? undefined : value;
}

export function TicketsFilterBar({
    categories,
    departments,
    canFilterByAssignee = false,
}: TicketsFilterBarProps): React.ReactElement {
    const router = useRouter();
    const pathname = usePathname() ?? "/tickets";
    const searchParams = useSearchParams();

    // Ref sempre apontando para o `searchParams` mais recente. Garante
    // que callbacks/timers leiam a versão atual ao mesclar filtros, em
    // vez de uma versão capturada em um render antigo (importante quando
    // o debounce do input é resolvido após outra mudança de filtro).
    const searchParamsRef = React.useRef(searchParams);
    React.useEffect(() => {
        searchParamsRef.current = searchParams;
    }, [searchParams]);

    // ── Leituras derivadas do URL ──────────────────────────────
    const currentQ = readParam(searchParams, "q") ?? "";
    const currentStatus = readParam(searchParams, "status") ?? ALL;
    const currentPriority = readParam(searchParams, "priority") ?? ALL;
    const currentCategory = readParam(searchParams, "categoryId") ?? ALL;
    const currentDepartment = readParam(searchParams, "departmentId") ?? ALL;
    const currentAssignee = readParam(searchParams, "assignee") ?? ALL;
    const currentSort = readParam(searchParams, "sort") ?? DEFAULT_SORT;
    const currentDir = readParam(searchParams, "dir") ?? DEFAULT_DIR;

    // ── Estado local do input de busca ─────────────────────────
    const [searchValue, setSearchValue] = React.useState(currentQ);

    // Última versão de `q` que esta instância empurrou ao URL. Serve
    // para detectar se um `currentQ` recém-chegado veio "de nós"
    // (debounce/Limpar) ou de fora (botão back, link manual).
    const lastSentRef = React.useRef(currentQ);

    /**
     * Mescla `updates` com a query string atual e empurra para o URL.
     *
     * - `value === null | "" | ALL` remove a chave, permitindo o usuário
     *   voltar para "Todos" sem deixar o param sujo no histórico.
     * - O cursor de paginação é sempre descartado: ele referencia uma
     *   linha específica que pode não existir mais sob os filtros novos.
     */
    const pushUpdate = React.useCallback(
        (updates: Record<string, string | null>) => {
            const sp = new URLSearchParams(searchParamsRef.current.toString());
            sp.delete("cursor");
            for (const [key, value] of Object.entries(updates)) {
                if (value === null || value === ALL || value.length === 0) {
                    sp.delete(key);
                } else {
                    sp.set(key, value);
                }
            }
            const qs = sp.toString();
            const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
            router.replace(url, { scroll: false });
        },
        [pathname, router],
    );

    // Sincroniza o input quando o URL muda externamente — botão Limpar
    // (que reseta `lastSentRef` antes de chamar `replace`), navegação
    // back/forward do navegador, ou um link interno que aponta para
    // `/tickets?q=...`. Caso a mudança tenha sido empurrada por nós, a
    // referência bate e o efeito é no-op.
    React.useEffect(() => {
        if (currentQ === lastSentRef.current) return;
        setSearchValue(currentQ);
        lastSentRef.current = currentQ;
    }, [currentQ]);

    // Debounce: digita → após 300ms sem novas teclas, empurra `q` ao URL.
    React.useEffect(() => {
        const trimmed = searchValue.trim();
        if (trimmed === lastSentRef.current) return;
        const handle = window.setTimeout(() => {
            lastSentRef.current = trimmed;
            pushUpdate({ q: trimmed.length > 0 ? trimmed : null });
        }, SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(handle);
    }, [searchValue, pushUpdate]);

    /**
     * "Limpar filtros" — descarta toda a query string, restaurando
     * ordenação default e removendo o cursor. Atualiza também o
     * `lastSentRef` antes de navegar para evitar que o efeito de sync
     * trate isso como mudança externa e dispare um setState redundante.
     */
    function handleClear(): void {
        setSearchValue("");
        lastSentRef.current = "";
        router.replace(pathname, { scroll: false });
    }

    const hasActiveFilters =
        currentQ.length > 0 ||
        currentStatus !== ALL ||
        currentPriority !== ALL ||
        currentCategory !== ALL ||
        currentDepartment !== ALL ||
        currentAssignee !== ALL ||
        currentSort !== DEFAULT_SORT ||
        currentDir !== DEFAULT_DIR;

    return (
        <section
            role="search"
            aria-label="Filtros de tickets"
            className="mb-4 flex flex-col gap-3"
        >
            {/* Linha 1: busca textual ocupa o eixo principal. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--ink-3)"
                    />
                    <Input
                        type="search"
                        inputMode="search"
                        autoComplete="off"
                        placeholder="Buscar por título ou ID (ex.: NVD-1042)"
                        aria-label="Buscar por título ou ID"
                        className="pl-9"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                    />
                </div>

                {hasActiveFilters ? (
                    <Button
                        variant="ghost"
                        size="md"
                        icon={<X aria-hidden="true" />}
                        onClick={handleClear}
                    >
                        Limpar filtros
                    </Button>
                ) : null}
            </div>

            {/* Linha 2: selects encurtam para grids responsivos. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <FilterSelect
                    label="Status"
                    value={currentStatus}
                    onChange={(v) => pushUpdate({ status: v })}
                    options={[
                        { value: ALL, label: "Todos os status" },
                        ...STATUSES.map((s: TicketStatus) => ({
                            value: s,
                            label: STATUS_LABELS_PT[s],
                        })),
                    ]}
                />

                <FilterSelect
                    label="Prioridade"
                    value={currentPriority}
                    onChange={(v) => pushUpdate({ priority: v })}
                    options={[
                        { value: ALL, label: "Todas as prioridades" },
                        ...PRIORITIES.map((p: Priority) => ({
                            value: p,
                            label: PRIORITY_LABELS_PT[p],
                        })),
                    ]}
                />

                <FilterSelect
                    label="Categoria"
                    value={currentCategory}
                    onChange={(v) => pushUpdate({ categoryId: v })}
                    options={[
                        { value: ALL, label: "Todas as categorias" },
                        ...categories.map((c) => ({
                            value: c.id,
                            label: c.active === false
                                ? `${c.label} (inativa)`
                                : c.label,
                        })),
                    ]}
                />

                <FilterSelect
                    label="Departamento"
                    value={currentDepartment}
                    onChange={(v) => pushUpdate({ departmentId: v })}
                    options={[
                        { value: ALL, label: "Todos os departamentos" },
                        ...departments.map((d) => ({
                            value: d.id,
                            label: d.name,
                        })),
                    ]}
                />

                {canFilterByAssignee ? (
                    <FilterSelect
                        label="Responsável"
                        value={currentAssignee}
                        onChange={(v) => pushUpdate({ assignee: v })}
                        options={ASSIGNEE_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label,
                        }))}
                    />
                ) : null}

                <div className="flex gap-2">
                    <FilterSelect
                        label="Ordenar por"
                        value={currentSort}
                        onChange={(v) => pushUpdate({ sort: v })}
                        options={SORT_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label,
                        }))}
                        className="flex-1"
                    />
                    <FilterSelect
                        label="Direção"
                        value={currentDir}
                        onChange={(v) => pushUpdate({ dir: v })}
                        options={DIR_OPTIONS.map((o) => ({
                            value: o.value,
                            label: o.label,
                        }))}
                        className="w-[7.5rem]"
                    />
                </div>
            </div>
        </section>
    );
}

/**
 * Pequeno wrapper de `Select` para reduzir boilerplate na barra. Cada
 * filtro vira: `<FilterSelect label={...} value={...} onChange={...}
 * options={...} />`. O `aria-label` no trigger garante leitura por
 * screen reader mesmo sem `<label>` visível, e o `placeholder` espelha
 * o item "Todos" para feedback consistente.
 */
function FilterSelect({
    label,
    value,
    onChange,
    options,
    className,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    options: ReadonlyArray<{ value: string; label: string }>;
    className?: string;
}): React.ReactElement {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label} className={className}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
