/**
 * `AttachmentChip` — chip compacto para representar um anexo.
 *
 * Exibe ícone (derivado do MIME), nome do arquivo (com truncamento) e o
 * tamanho formatado em B/KB/MB. Quando recebe `href`, o corpo é
 * renderizado como `<a>` com `download`, permitindo baixar o arquivo
 * diretamente. Quando recebe `onRemove`, exibe um botão `X` à direita
 * para remover o anexo do contexto onde estiver listado (ex.: formulário
 * de criação de ticket antes do submit). O botão de remoção é
 * mantido como sibling do `<a>` — botões dentro de âncoras seriam HTML
 * inválido.
 *
 * Mapeamento de ícone por MIME (Lucide):
 *   - `image/*`                                                          → `Image`
 *   - `application/pdf`                                                  → `FileText`
 *   - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → `FileSpreadsheet`
 *   - `text/*`                                                           → `FileText`
 *   - default                                                            → `File`
 *
 * Validates: R8, R19.4
 */

import * as React from "react";

import { File, FileSpreadsheet, FileText, Image, X } from "lucide-react";

import { cn } from "@/lib/cn";

const KB = 1024;
const MB = KB * 1024;

/**
 * Formata um tamanho em bytes de forma compacta:
 *
 *   - `< 1 KB`  → bytes inteiros (`"512 B"`)
 *   - `< 1 MB`  → kilobytes com uma casa (`"12.3 KB"`)
 *   - caso contrário → megabytes com uma casa (`"4.2 MB"`)
 *
 * Valores não-finitos ou negativos retornam `"0 B"`.
 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < KB) return `${Math.floor(bytes)} B`;
    if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
    return `${(bytes / MB).toFixed(1)} MB`;
}

/** Resolve o componente de ícone Lucide adequado para o MIME informado. */
function iconForMime(mime: string): React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
}> {
    if (mime.startsWith("image/")) return Image;
    if (mime === "application/pdf") return FileText;
    if (
        mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
        return FileSpreadsheet;
    }
    if (mime.startsWith("text/")) return FileText;
    return File;
}

export interface AttachmentChipProps {
    /** Identificador estável do anexo (usado em `onRemove`). */
    id: string;
    /** Nome de arquivo exibido. */
    name: string;
    /** Tamanho em bytes. */
    size: number;
    /** MIME type usado para escolher o ícone. */
    mime: string;
    /** URL para download (ex.: `/api/uploads/{id}`). */
    href?: string;
    /** Callback chamado ao clicar no botão `X`. */
    onRemove?: (id: string) => void;
    /** Classe extra para o container raiz. */
    className?: string;
}

/** Estilo base do "corpo" do chip (sem o botão de remoção). */
const BODY_CLASSES =
    "inline-flex items-center gap-2 rounded-(--r-3) border border-(--line) bg-(--bg-elev) px-3 py-2 text-sm text-(--ink)";

/**
 * Chip de anexo. Quando `href` é fornecido o corpo vira um `<a download>`;
 * caso contrário fica como `<div>`. O botão de remoção (`X`) só aparece
 * quando `onRemove` é informado.
 */
export function AttachmentChip({
    id,
    name,
    size,
    mime,
    href,
    onRemove,
    className,
}: AttachmentChipProps): React.ReactElement {
    const Icon = iconForMime(mime);
    const sizeLabel = formatBytes(size);

    const body = (
        <>
            <Icon
                className="size-4 shrink-0 text-(--ink-2)"
                aria-hidden="true"
            />
            <span className="max-w-[16rem] truncate" title={name}>
                {name}
            </span>
            <span className="shrink-0 text-xs text-(--ink-3)">
                {sizeLabel}
            </span>
        </>
    );

    const bodyElement = href ? (
        <a
            href={href}
            download={name}
            className={cn(
                BODY_CLASSES,
                "transition-colors hover:bg-(--bg-sunk)",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
            )}
        >
            {body}
        </a>
    ) : (
        <div className={BODY_CLASSES}>{body}</div>
    );

    if (!onRemove) {
        return (
            <span className={cn("inline-flex", className)}>{bodyElement}</span>
        );
    }

    return (
        <span className={cn("inline-flex items-center gap-1", className)}>
            {bodyElement}
            <button
                type="button"
                onClick={() => onRemove(id)}
                aria-label={`Remover anexo ${name}`}
                className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-(--r-2) text-(--ink-3)",
                    "transition-colors hover:bg-(--bg-sunk) hover:text-(--ink)",
                    "outline-none focus-visible:ring-2 focus-visible:ring-(--accent)",
                )}
            >
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </span>
    );
}
