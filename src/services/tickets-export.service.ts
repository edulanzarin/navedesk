/**
 * Tickets export service — gera um arquivo `.csv` com a lista de
 * tickets respeitando os filtros e o escopo do solicitante (R11.6,
 * R11.7).
 *
 * Pipeline:
 *
 * 1. Valida o payload (filtros + formato) com Zod. Filtros aceitos
 *    espelham 1:1 os de `tickets.repo.listWithFilters` para que a UI
 *    possa serializar a mesma `URLSearchParams` que alimenta a
 *    listagem.
 * 2. Verifica `canExportTickets` (R11.6).
 * 3. Itera sobre `listWithFilters` em janelas de
 *    `EXPORT_PAGE_SIZE = 200` linhas usando o cursor opaco do
 *    repositório, acumulando até atingir `EXPORT_MAX_ROWS = 10_000`.
 *    Caso o filtro produza mais que esse limite, devolve
 *    `ActionResult.error.code = "TOO_MANY_ROWS"` orientando o usuário
 *    a refinar os filtros — proteção contra exports gigantes que
 *    esgotariam memória do servidor.
 * 4. Resolve nomes de categoria, departamento e usuários (solicitante,
 *    responsável) numa única consulta `inArray` por tabela, evitando
 *    N+1.
 * 5. Serializa em CSV com escaping conforme RFC 4180:
 *    - Aspas duplas escapadas como `""`.
 *    - Campos com `,`, `"`, `\n` ou `\r` envolvidos em aspas duplas.
 *    - Quebras de linha CRLF (`\r\n`) entre registros, padrão CSV
 *      portátil entre Excel e LibreOffice.
 *    - BOM UTF-8 (`\uFEFF`) no início para que o Excel interprete o
 *      arquivo como UTF-8 ao abrir direto.
 * 6. O nome do arquivo segue o padrão
 *    `navedesk-tickets-YYYYMMDD-HHmm.csv` em UTC para que múltiplos
 *    downloads no mesmo cliente não colidam.
 *
 * Suporte a XLSX: o tipo de retorno modela o formato (`csv | xlsx`) e
 * o `mimeType` correspondente, mas a geração de XLSX exige uma
 * dependência adicional (`xlsx`/`exceljs`) que ainda não está no
 * projeto. Por enquanto, o serviço aceita `format = "xlsx"` apenas se
 * essa dependência for instalada — a implementação atual responde com
 * `NOT_IMPLEMENTED` orientando o usuário a usar CSV. Quando o pacote
 * for adicionado, basta substituir o branch `xlsx` em `buildPayload`.
 *
 * O `content` é sempre uma `string`: para CSV é o conteúdo direto
 * (codificado como UTF-8 ao ser salvo pelo cliente); para futuros
 * formatos binários, será `base64` da planilha — o `mimeType`
 * orienta o cliente sobre como tratar.
 *
 * Validates: R11.6, R11.7.
 */

import { inArray } from "drizzle-orm";

import { z } from "zod";

import { db } from "@/db/client";
import {
    listWithFilters,
    type ListFilters,
} from "@/db/repositories/tickets.repo";
import { categories, departments, users } from "@/db/schema";
import { canExportTickets } from "@/lib/policies";
import { PRIORITIES, STATUSES } from "@/lib/constants";
import type {
    ActionResult,
    Priority,
    SessionUser,
    Ticket,
    TicketStatus,
} from "@/types/domain";

/**
 * Tamanho de cada página interna durante a iteração. Maior que o
 * default da listagem (50) para reduzir round-trips ao banco; menor que
 * `EXPORT_MAX_ROWS` para manter cada página com tamanho previsível em
 * memória.
 */
const EXPORT_PAGE_SIZE = 200;

/**
 * Limite duro de linhas exportadas em uma única chamada. Acima desse
 * volume o serviço devolve `TOO_MANY_ROWS` com mensagem em pt-BR
 * pedindo refino dos filtros. Foi escolhido para caber confortavelmente
 * em memória (~10k linhas × ~1KB/linha ≈ 10MB de CSV) sem precisar
 * streamar — a UI atual baixa o arquivo via `data:` URL/Blob.
 */
const EXPORT_MAX_ROWS = 10_000;

/**
 * Formatos suportados pelo export. CSV é nativo; XLSX é aceito no
 * payload mas, na ausência da dependência `xlsx`, retornado como
 * `NOT_IMPLEMENTED` em runtime.
 */
export type ExportFormat = "csv" | "xlsx";

/**
 * Resultado retornado pela action ao cliente.
 *
 * - `filename`: nome sugerido para o download (com extensão).
 * - `content`: para CSV, o texto bruto (a UI deve criar um `Blob` com
 *   `type=text/csv;charset=utf-8` e disparar o download). Para
 *   formatos binários futuros, este campo carrega o conteúdo em
 *   base64 — diferenciado pelo `encoding`.
 * - `mimeType`: MIME oficial do formato (RFC 7111 para CSV).
 * - `encoding`: `"utf-8"` para CSV, `"base64"` para futuros formatos
 *   binários. Permite que o cliente decida entre `Blob([content])` e
 *   `Blob([Uint8Array.from(atob(content), c => c.charCodeAt(0))])`.
 * - `rowCount`: número de linhas exportadas (sem o cabeçalho), útil
 *   para feedback do tipo "Exportados N tickets".
 */
export interface ExportPayload {
    filename: string;
    content: string;
    mimeType: string;
    encoding: "utf-8" | "base64";
    rowCount: number;
}

/**
 * Schema de validação dos filtros + formato. Reflete o subset de
 * `ListFilters` aceito pelo repo, omitindo `cursor` e `limit` (a
 * iteração interna controla a paginação) e `sortBy`/`sortDir` (a
 * ordenação default do repo é apropriada para export).
 *
 * `assigneeId` aceita uma string crua, a sentinela `"me"` ou
 * `null` (sem responsável). Strings vazias são normalizadas para
 * `undefined` antes do parse para tolerar `URLSearchParams` que
 * carregam chaves com valor "".
 */
const ExportFiltersSchema = z.object({
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    categoryId: z.string().min(1).optional(),
    departmentId: z.string().min(1).optional(),
    assigneeId: z.union([z.string().min(1), z.null()]).optional(),
    requesterId: z.string().min(1).optional(),
    q: z.string().min(1).optional(),
});

const ExportInputSchema = z.object({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    filters: ExportFiltersSchema.default({}),
});

/** Tipo público aceito pela `exportTicketsAction`. */
export type ExportTicketsInput = z.input<typeof ExportInputSchema>;

/**
 * Cabeçalho do CSV em pt-BR (R11.6). A ordem das colunas é fixa e
 * coerente com a especificação:
 *
 *   id, title, status, priority, category, department, requester,
 *   assignee, createdAt, slaDeadline, resolvedAt
 *
 * Usar rótulos em pt-BR no header (em vez dos identificadores
 * técnicos) facilita a leitura no Excel/LibreOffice pelo time de
 * operações, que é o público-alvo do export.
 */
const CSV_HEADERS_PT = [
    "ID",
    "Título",
    "Status",
    "Prioridade",
    "Categoria",
    "Departamento",
    "Solicitante",
    "Responsável",
    "Criado em",
    "Prazo SLA",
    "Resolvido em",
] as const;

/**
 * Escapa um campo conforme RFC 4180.
 *
 * Regras aplicadas:
 * - `null`/`undefined` → string vazia.
 * - Aspas duplas duplicadas (`"` → `""`).
 * - Campo é envolvido em aspas se contiver `,`, `"`, `\n` ou `\r`.
 * - Demais caracteres passam transparente (UTF-8).
 *
 * Manter o escape dentro do serviço (em vez de delegar a uma lib)
 * deixa o comportamento auditável e evita uma dependência só para
 * isso. A ausência de pontos-e-vírgulas como separador é proposital:
 * o padrão internacional é vírgula; o Excel pt-BR consegue importar
 * corretamente desde que o arquivo tenha BOM UTF-8 (que adicionamos).
 */
function csvEscape(value: string | null | undefined): string {
    if (value === null || value === undefined) return "";
    const needsQuoting =
        value.includes(",") ||
        value.includes('"') ||
        value.includes("\n") ||
        value.includes("\r");
    const escaped = value.replace(/"/g, '""');
    return needsQuoting ? `"${escaped}"` : escaped;
}

/**
 * Formata uma data como ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ssZ`).
 *
 * Preferimos ISO ao formato regional pt-BR (`dd/mm/yyyy`) para que o
 * arquivo seja **ordenável lexicograficamente** em qualquer planilha
 * sem depender de configuração regional. Quem quiser exibir em pt-BR
 * faz a formatação na própria planilha.
 *
 * `null`/`undefined` → string vazia, mantendo a coluna alinhada.
 */
function fmtIso(d: Date | null | undefined): string {
    if (!d) return "";
    return d.toISOString();
}

/**
 * Gera um nome de arquivo estável para o download, com timestamp UTC.
 *
 * Formato: `navedesk-tickets-YYYYMMDD-HHmm.<ext>`. Usamos UTC para que
 * exports feitos em horários próximos não colidam mesmo com clientes
 * em fusos diferentes.
 */
function buildFilename(format: ExportFormat, now: Date): string {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mi = String(now.getUTCMinutes()).padStart(2, "0");
    return `navedesk-tickets-${yyyy}${mm}${dd}-${hh}${mi}.${format}`;
}

/**
 * Converte os filtros validados em `ListFilters` aceitos pelo repo.
 *
 * Diferenças intencionais:
 * - `cursor` e `limit` ficam fora — a iteração é controlada por este
 *   serviço.
 * - `sortBy`/`sortDir` não são expostos: o export usa o default
 *   (`updatedAt DESC`), que dá uma ordem estável para inspeção. Os
 *   campos de tempo continuam disponíveis para reordenar na planilha.
 * - `assigneeId` aceita `null` (sem responsável) ou uma string;
 *   `"me"` é resolvido pelo próprio repo a partir do `actor`.
 */
function toListFilters(
    parsed: z.infer<typeof ExportInputSchema>["filters"],
): Omit<ListFilters, "cursor" | "limit" | "sortBy" | "sortDir"> {
    return {
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.priority !== undefined
            ? { priority: parsed.priority }
            : {}),
        ...(parsed.categoryId !== undefined
            ? { categoryId: parsed.categoryId }
            : {}),
        ...(parsed.departmentId !== undefined
            ? { departmentId: parsed.departmentId }
            : {}),
        ...(parsed.assigneeId !== undefined
            ? { assigneeId: parsed.assigneeId }
            : {}),
        ...(parsed.requesterId !== undefined
            ? { requesterId: parsed.requesterId }
            : {}),
        ...(parsed.q !== undefined ? { q: parsed.q } : {}),
    };
}

/**
 * Itera `listWithFilters` página a página, acumulando até
 * `EXPORT_MAX_ROWS` linhas. Devolve `null` quando o conjunto excede o
 * limite — sinal para `exportTickets` retornar `TOO_MANY_ROWS`.
 *
 * A escolha por `cursor` paginado (em vez de `OFFSET`) é deliberada:
 * mantém complexidade O(n) consistente mesmo para os tickets mais
 * antigos e é o mesmo caminho já validado pela listagem da página.
 */
async function collectAllRows(
    actor: SessionUser,
    base: ReturnType<typeof toListFilters>,
): Promise<Ticket[] | null> {
    const acc: Ticket[] = [];
    let cursor: ListFilters["cursor"] | undefined;

    // Loop limitado: cada iteração reduz o conjunto restante em pelo
    // menos `EXPORT_PAGE_SIZE`; quando `nextCursor === null`, o repo já
    // entregou tudo. O guard `acc.length > EXPORT_MAX_ROWS` é a saída
    // explícita para sinalizar excesso.
    while (true) {
        const filters: ListFilters = {
            ...base,
            limit: EXPORT_PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
        };

        const page = await listWithFilters(db, actor, filters);
        for (const row of page.rows) acc.push(row);

        if (acc.length > EXPORT_MAX_ROWS) {
            return null;
        }

        if (page.nextCursor === null) {
            return acc;
        }
        cursor = page.nextCursor;
    }
}

/**
 * Serializa as linhas em CSV (R11.6). A função é pura: recebe os dados
 * já enriquecidos e produz a string final. Mantê-la separada do I/O
 * facilita testes unitários (sem precisar de banco) e reutilização caso
 * o XLSX use o mesmo enriquecimento.
 *
 * O BOM UTF-8 é prefixado para que o Excel reconheça o encoding
 * automaticamente; sem ele, acentos pt-BR vêm corrompidos no Windows.
 */
function rowsToCsv(rows: ReadonlyArray<readonly string[]>): string {
    const lines = rows.map((cols) => cols.map(csvEscape).join(","));
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * Constrói o array bidimensional de strings (cabeçalho + linhas) para
 * a saída tabular. Centraliza a montagem para reuso futuro pelo
 * caminho XLSX.
 */
function buildTable(
    tickets: ReadonlyArray<Ticket>,
    catById: Map<string, string>,
    deptById: Map<string, string>,
    userById: Map<string, string>,
): string[][] {
    const header = [...CSV_HEADERS_PT];
    const body = tickets.map((t) => [
        t.id,
        t.title,
        t.status,
        t.priority,
        catById.get(t.categoryId) ?? t.categoryId,
        deptById.get(t.departmentId) ?? t.departmentId,
        userById.get(t.requesterId) ?? "—",
        t.assigneeId ? (userById.get(t.assigneeId) ?? "—") : "",
        fmtIso(t.createdAt),
        fmtIso(t.slaDeadline),
        fmtIso(t.resolvedAt),
    ]);
    return [header, ...body];
}

/**
 * Resolve em um único round-trip (por tabela) os nomes humanos para
 * categorias, departamentos e usuários referenciados pelo conjunto
 * exportado. Evita N+1 e mantém a complexidade total em O(n) sobre as
 * linhas exportadas.
 */
async function resolveLookupMaps(rows: ReadonlyArray<Ticket>): Promise<{
    catById: Map<string, string>;
    deptById: Map<string, string>;
    userById: Map<string, string>;
}> {
    const categoryIds = new Set<string>();
    const departmentIds = new Set<string>();
    const userIds = new Set<string>();

    for (const t of rows) {
        categoryIds.add(t.categoryId);
        departmentIds.add(t.departmentId);
        userIds.add(t.requesterId);
        if (t.assigneeId) userIds.add(t.assigneeId);
    }

    const [categoryRows, departmentRows, userRows] = await Promise.all([
        categoryIds.size > 0
            ? db
                .select({ id: categories.id, label: categories.label })
                .from(categories)
                .where(inArray(categories.id, Array.from(categoryIds)))
            : Promise.resolve([] as { id: string; label: string }[]),
        departmentIds.size > 0
            ? db
                .select({ id: departments.id, name: departments.name })
                .from(departments)
                .where(
                    inArray(departments.id, Array.from(departmentIds)),
                )
            : Promise.resolve([] as { id: string; name: string }[]),
        userIds.size > 0
            ? db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(inArray(users.id, Array.from(userIds)))
            : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    return {
        catById: new Map(categoryRows.map((c) => [c.id, c.label])),
        deptById: new Map(departmentRows.map((d) => [d.id, d.name])),
        userById: new Map(userRows.map((u) => [u.id, u.name])),
    };
}

/**
 * Exporta a lista de tickets respeitando filtros e RBAC.
 *
 * Códigos de erro retornados:
 * - `VALIDATION`: payload inválido (filtros mal formados ou formato
 *   desconhecido).
 * - `FORBIDDEN`: usuário sem permissão para exportar.
 * - `TOO_MANY_ROWS`: o conjunto excede `EXPORT_MAX_ROWS`. A mensagem
 *   instrui o usuário a refinar os filtros.
 * - `NOT_IMPLEMENTED`: formato `xlsx` solicitado mas a dependência
 *   ainda não está disponível.
 *
 * Em sucesso, devolve `ExportPayload` pronto para o cliente disparar
 * o download via `Blob` + `<a download>`.
 */
export async function exportTickets(
    actor: SessionUser,
    rawInput: unknown,
): Promise<ActionResult<ExportPayload>> {
    // 1. Validação de borda.
    const parsed = ExportInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field =
            issue && issue.path.length > 0
                ? String(issue.path.join("."))
                : undefined;
        return {
            ok: false,
            error: {
                code: "VALIDATION",
                message: issue?.message ?? "Filtros inválidos.",
                ...(field ? { field } : {}),
            },
        };
    }

    // 2. RBAC.
    if (!canExportTickets(actor)) {
        return {
            ok: false,
            error: {
                code: "FORBIDDEN",
                message:
                    "Você não tem permissão para exportar tickets.",
            },
        };
    }

    // 3. Suporte a formato. XLSX exigirá uma dependência adicional
    // (`xlsx` ou `exceljs`); enquanto não está instalada, recusamos com
    // mensagem clara em vez de silenciar o pedido.
    if (parsed.data.format === "xlsx") {
        return {
            ok: false,
            error: {
                code: "NOT_IMPLEMENTED",
                message:
                    "Exportação em XLSX ainda não está disponível. Use o formato CSV.",
                field: "format",
            },
        };
    }

    // 4. Coleta paginada com limite duro.
    const baseFilters = toListFilters(parsed.data.filters);
    const collected = await collectAllRows(actor, baseFilters);
    if (collected === null) {
        return {
            ok: false,
            error: {
                code: "TOO_MANY_ROWS",
                message: `O filtro retornou mais de ${EXPORT_MAX_ROWS} tickets. Refine os filtros e tente novamente.`,
            },
        };
    }

    // 5. Enriquecimento + serialização.
    const { catById, deptById, userById } = await resolveLookupMaps(collected);
    const table = buildTable(collected, catById, deptById, userById);
    const csv = rowsToCsv(table);

    const now = new Date();
    return {
        ok: true,
        data: {
            filename: buildFilename("csv", now),
            content: csv,
            mimeType: "text/csv;charset=utf-8",
            encoding: "utf-8",
            rowCount: collected.length,
        },
    };
}
