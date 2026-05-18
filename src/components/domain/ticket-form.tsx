/**
 * `TicketForm` — formulário de criação de ticket usado em `/tickets/novo`.
 *
 * Client Component porque combina três responsabilidades que vivem
 * naturalmente no cliente:
 *
 * 1. Validação imediata via `react-hook-form` + `zodResolver` sobre o
 *    `CreateTicketSchema` (R3.1, R3.2). O resolver ataca o problema de
 *    UX caro do formulário antes mesmo da Server Action ser invocada,
 *    apontando o primeiro campo inválido em pt-BR.
 * 2. Upload incremental: cada arquivo escolhido é enviado de imediato
 *    para `POST /api/uploads`. Esse endpoint já faz autenticação, rate
 *    limit, allowlist de MIME e checagem de magic bytes (R8.1–R8.6) e
 *    devolve `{ id, url, name, size, mime }`. Mantemos no estado tanto
 *    a lista de UUIDs (campo `attachments` que vai para o submit) quanto
 *    o metadado completo, para podermos exibir cada anexo via
 *    `AttachmentChip` com botão `X` de remoção (R8, R3.6).
 * 3. Pré-atribuição opcional (R3.8): quando o consumidor passa
 *    `allowAssign`, o formulário renderiza um `Select` extra com a lista
 *    de técnicos/admins. O valor escolhido é incluído em `assigneeId`
 *    no objeto entregue ao `onSubmit`. A política `canAssignOthers` é
 *    aplicada pelo serviço — esta camada só decide se mostra o campo.
 *
 * O componente não conhece a Server Action: recebe `onSubmit` por
 * prop. A página `/tickets/novo` (task 21.2) é quem injeta a chamada a
 * `createTicketAction` e cuida do redirect para `/tickets/{id}` em
 * sucesso. Em falha, este formulário mostra um toast de erro com a
 * mensagem retornada e mantém os campos preenchidos para correção.
 *
 * Validates: R3.1, R3.2, R3.8, R8.
 */

"use client";

import * as React from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lightbulb, Paperclip } from "lucide-react";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import { suggestKbArticlesAction } from "@/actions/kb";
import { AttachmentChip } from "@/components/domain/attachment-chip";
import { CategoryChip } from "@/components/domain/category-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { PRIORITIES, PRIORITY_LABELS_PT } from "@/lib/constants";
import {
    CreateTicketSchema,
    UploadConstraints,
    type CreateTicketInput,
} from "@/lib/schemas";
import type { KbArticleSuggestion } from "@/services/kb.service";

/**
 * Schema de formulário.
 *
 * Estende `CreateTicketSchema` com `assigneeId` opcional. O serviço
 * `createTicket` ainda não consome `assigneeId` na criação — quando a
 * página decide pré-atribuir, ela emite `assignTicketAction` logo após
 * `createTicketAction` em sucesso. Mantemos o campo no schema do form
 * apenas para integração com `react-hook-form`.
 */
const TicketFormSchema = CreateTicketSchema.extend({
    assigneeId: z.string().uuid().optional(),
});

/**
 * Tamanho mínimo do título antes de disparar a sugestão da KB. Casa com
 * `KbSuggestQuerySchema.query.min(3)` em `lib/schemas.ts`. Manter o
 * limiar aqui evita uma ida inútil ao servidor para termos curtos.
 */
const KB_SUGGEST_MIN_LENGTH = 3;

/**
 * Janela de debounce em milissegundos para a chamada de sugestões da KB.
 * 300 ms é suficiente para acomodar digitação rápida sem prejudicar a
 * percepção de responsividade.
 */
const KB_SUGGEST_DEBOUNCE_MS = 300;

/** Valores do formulário (inclui `assigneeId` opcional). */
export type TicketFormValues = z.infer<typeof TicketFormSchema>;

/**
 * Metadado completo de um anexo já carregado, conforme retornado por
 * `POST /api/uploads`. Mantido em estado próprio (separado do array de
 * UUIDs do form) para que possamos renderizar os `AttachmentChip` sem
 * precisar reconsultar o servidor.
 */
interface UploadedAttachment {
    id: string;
    name: string;
    size: number;
    mime: string;
}

/** Resposta de erro padronizada do `POST /api/uploads`. */
interface UploadErrorBody {
    code?: string;
    message?: string;
}

export interface TicketFormProps {
    /** Categorias disponíveis para seleção. Vêm do servidor. */
    categories: ReadonlyArray<{
        id: string;
        label: string;
        sub?: string;
        icon: string;
    }>;
    /** Departamentos disponíveis para seleção. */
    departments: ReadonlyArray<{ id: string; name: string }>;
    /**
     * Lista de potenciais responsáveis (técnicos/admins). Só é usada
     * quando `allowAssign === true`.
     */
    assignees?: ReadonlyArray<{ id: string; name: string }>;
    /**
     * Quando `true`, exibe o campo de pré-atribuição. A página é
     * responsável por habilitar somente para `tecnico`/`admin` (R3.8).
     */
    allowAssign?: boolean;
    /**
     * Callback executado no submit válido. Recebe os valores tipados —
     * incluindo `assigneeId` quando preenchido. A página decide como
     * orquestrar `createTicketAction` e, opcionalmente, `assignTicketAction`.
     *
     * Em falha, deve devolver `{ ok: false, message }` para o form
     * exibir um toast de erro e manter os campos preenchidos.
     */
    onSubmit: (
        data: TicketFormValues,
    ) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
}

/**
 * Faz o upload incremental de um arquivo para `/api/uploads`.
 *
 * Retorna o metadado pronto para virar `UploadedAttachment`, ou lança
 * `Error` com a mensagem amigável vinda do servidor (já em pt-BR). O
 * campo do `FormData` é exatamente `"file"`, conforme exigido pelo
 * route handler em `src/app/api/uploads/route.ts`.
 */
async function uploadFile(file: File): Promise<UploadedAttachment> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
    });

    if (!res.ok) {
        let body: UploadErrorBody = {};
        try {
            body = (await res.json()) as UploadErrorBody;
        } catch {
            // Resposta sem JSON — usamos a mensagem genérica abaixo.
        }
        throw new Error(body.message ?? "Falha ao enviar o arquivo.");
    }

    return (await res.json()) as UploadedAttachment;
}

/**
 * Form de criação de ticket. Componente "burro" — não conhece a Server
 * Action; toda a integração com o backend (criação + revalidação +
 * redirect) fica a cargo da página que o consome.
 */
export function TicketForm({
    categories,
    departments,
    assignees = [],
    allowAssign = false,
    onSubmit,
}: TicketFormProps): React.ReactElement {
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = React.useState(false);
    const [uploadedFiles, setUploadedFiles] = React.useState<
        UploadedAttachment[]
    >([]);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        getValues,
        formState: { errors, isSubmitting },
    } = useForm<TicketFormValues>({
        // O schema é uma extensão de `CreateTicketSchema`. O cast garante
        // que o resolver fique tipado em cima do shape do formulário sem
        // perder a inferência do `react-hook-form`.
        resolver: zodResolver(TicketFormSchema) as Resolver<TicketFormValues>,
        defaultValues: {
            title: "",
            description: "",
            categoryId: "",
            departmentId: "",
            priority: "media",
            attachments: [],
            assigneeId: undefined,
        },
    });

    // Observa apenas os campos que precisamos espelhar no DOM como
    // controles "controlados" (Selects do Radix). Os demais (`title`,
    // `description`) ficam não-controlados via `register`.
    const categoryId = watch("categoryId");
    const departmentId = watch("departmentId");
    const priority = watch("priority");
    const assigneeId = watch("assigneeId");
    const titleValue = watch("title") ?? "";
    const descriptionValue = watch("description") ?? "";

    // ── Sugestões da KB ao digitar o título (R13.8) ───────────────
    const [kbSuggestions, setKbSuggestions] = React.useState<
        KbArticleSuggestion[]
    >([]);
    const [kbDismissed, setKbDismissed] = React.useState(false);

    React.useEffect(() => {
        const trimmed = titleValue.trim();
        if (trimmed.length < KB_SUGGEST_MIN_LENGTH) {
            // Limpa para que a primeira sugestão futura apareça com
            // aria-live disparando, e reabilita a dispensa caso o
            // usuário tenha fechado o painel anteriormente.
            setKbSuggestions([]);
            setKbDismissed(false);
            return undefined;
        }

        // Debounce simples: agenda a chamada e cancela quando o termo
        // muda antes do timeout terminar. Evita disparar uma action por
        // keystroke. `AbortController` cobre o caso de uma chamada já em
        // voo ficar obsoleta — ignoramos o resultado quando o effect
        // tiver sido limpo, sem precisar abortar a Server Action no
        // servidor.
        const aborted = { current: false };
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const result = await suggestKbArticlesAction({
                        query: trimmed,
                    });
                    if (aborted.current) return;
                    if (result.ok) {
                        setKbSuggestions(result.data);
                    } else {
                        // Erros do servidor (UNAUTHORIZED, etc.) caem aqui
                        // sem ruído na UI: o painel apenas não aparece.
                        setKbSuggestions([]);
                    }
                } catch {
                    if (!aborted.current) {
                        setKbSuggestions([]);
                    }
                }
            })();
        }, KB_SUGGEST_DEBOUNCE_MS);

        return () => {
            aborted.current = true;
            clearTimeout(timer);
        };
    }, [titleValue]);

    const showKbSuggestions =
        !kbDismissed &&
        kbSuggestions.length > 0 &&
        !errors.title &&
        titleValue.trim().length >= KB_SUGGEST_MIN_LENGTH;

    // ── Upload incremental ────────────────────────────────────────
    async function handleFilesSelected(
        e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;

        // Limpa o input imediatamente para permitir reescolher o mesmo
        // arquivo caso o upload falhe.
        e.target.value = "";

        setUploading(true);
        try {
            for (const file of files) {
                // Limite de 10 anexos vem do schema (`array(...).max(10)`).
                const current = getValues("attachments") ?? [];
                if (current.length >= 10) {
                    toast({
                        variant: "warn",
                        title: "Limite de anexos atingido",
                        description: "Máximo de 10 arquivos por chamado.",
                    });
                    break;
                }

                try {
                    const uploaded = await uploadFile(file);
                    setUploadedFiles((prev) => [...prev, uploaded]);
                    setValue(
                        "attachments",
                        [...(getValues("attachments") ?? []), uploaded.id],
                        { shouldValidate: true, shouldDirty: true },
                    );
                } catch (err) {
                    const message =
                        err instanceof Error
                            ? err.message
                            : "Falha ao enviar o arquivo.";
                    toast({
                        variant: "error",
                        title: "Falha no upload",
                        description: message,
                    });
                }
            }
        } finally {
            setUploading(false);
        }
    }

    function removeAttachment(id: string): void {
        setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
        setValue(
            "attachments",
            (getValues("attachments") ?? []).filter((a) => a !== id),
            { shouldValidate: true, shouldDirty: true },
        );
    }

    // ── Submit ────────────────────────────────────────────────────
    async function onValid(values: TicketFormValues): Promise<void> {
        // Quando `allowAssign` é falso, garantimos que `assigneeId` não
        // vaze para o handler — evita confusão na página caso ela leia
        // o campo cegamente.
        const payload: TicketFormValues = allowAssign
            ? values
            : { ...values, assigneeId: undefined };

        const result = await onSubmit(payload);
        if (!result.ok) {
            toast({
                variant: "error",
                title: "Não foi possível abrir o chamado",
                description: result.message,
            });
        }
    }

    // ── Render ────────────────────────────────────────────────────
    return (
        <form
            noValidate
            onSubmit={handleSubmit(onValid)}
            className="flex flex-col gap-5"
        >
            {/* Title ────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="ticket-title"
                    className="text-sm font-medium text-(--ink)"
                >
                    Título <span className="text-(--red)">*</span>
                </label>
                <Input
                    id="ticket-title"
                    placeholder="Resuma o problema em uma linha"
                    error={Boolean(errors.title)}
                    aria-describedby={
                        errors.title ? "ticket-title-error" : "ticket-title-hint"
                    }
                    {...register("title")}
                />
                {errors.title ? (
                    <p
                        id="ticket-title-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.title.message ?? "Informe um título válido."}
                    </p>
                ) : (
                    <p id="ticket-title-hint" className="text-xs text-(--ink-3)">
                        {titleValue.length < 5
                            ? `Mínimo 5 caracteres (${titleValue.length}/5)`
                            : `${titleValue.length}/120 caracteres`}
                    </p>
                )}

                {/* Sugestões da Base de Conhecimento (R13.8) — purely
                    additive: não bloqueia o fluxo de criação, apenas
                    sugere artigos relevantes para o título digitado. */}
                {showKbSuggestions ? (
                    <div
                        role="region"
                        aria-label="Sugestões da Base de Conhecimento"
                        className="mt-2 rounded-(--r-3) border border-(--accent-soft-2) bg-(--accent-soft) p-3"
                    >
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-(--accent)">
                                <Lightbulb
                                    aria-hidden="true"
                                    className="size-3.5"
                                />
                                Encontramos artigos que podem ajudar
                            </span>
                            <button
                                type="button"
                                onClick={() => setKbDismissed(true)}
                                className="text-xs text-(--ink-3) underline-offset-2 hover:text-(--ink-2) hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
                            >
                                Dispensar
                            </button>
                        </div>
                        <ul
                            aria-live="polite"
                            className="flex flex-col gap-1.5"
                        >
                            {kbSuggestions.map((s) => (
                                <li key={s.id}>
                                    <Link
                                        href={`/kb/${s.slug}`}
                                        target="_blank"
                                        rel="noopener"
                                        className="flex items-center gap-2 rounded-(--r-2) px-2 py-1.5 text-sm text-(--ink-2) hover:bg-(--bg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-1 focus-visible:ring-offset-(--bg)"
                                    >
                                        <CategoryChip
                                            icon={s.categoryIcon}
                                            label={s.categoryLabel}
                                            className="shrink-0 bg-(--bg) text-xs"
                                        />
                                        <span className="truncate font-medium text-(--ink)">
                                            {s.title}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs text-(--ink-3)">
                            Não encontrou? Continue criando o ticket abaixo.
                        </p>
                    </div>
                ) : null}
            </div>

            {/* Category + Department ───────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="ticket-category"
                        className="text-sm font-medium text-(--ink)"
                    >
                        Categoria <span className="text-(--red)">*</span>
                    </label>
                    <Select
                        value={categoryId || undefined}
                        onValueChange={(v) =>
                            setValue("categoryId", v, {
                                shouldValidate: true,
                                shouldDirty: true,
                            })
                        }
                    >
                        <SelectTrigger
                            id="ticket-category"
                            aria-invalid={Boolean(errors.categoryId) || undefined}
                            aria-describedby={
                                errors.categoryId
                                    ? "ticket-category-error"
                                    : undefined
                            }
                        >
                            <SelectValue placeholder="Selecionar categoria…" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                    {c.sub ? `${c.label} — ${c.sub}` : c.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {errors.categoryId ? (
                        <p
                            id="ticket-category-error"
                            className="text-xs text-(--red)"
                        >
                            {errors.categoryId.message ??
                                "Selecione uma categoria."}
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="ticket-department"
                        className="text-sm font-medium text-(--ink)"
                    >
                        Departamento <span className="text-(--red)">*</span>
                    </label>
                    <Select
                        value={departmentId || undefined}
                        onValueChange={(v) =>
                            setValue("departmentId", v, {
                                shouldValidate: true,
                                shouldDirty: true,
                            })
                        }
                    >
                        <SelectTrigger
                            id="ticket-department"
                            aria-invalid={Boolean(errors.departmentId) || undefined}
                            aria-describedby={
                                errors.departmentId
                                    ? "ticket-department-error"
                                    : undefined
                            }
                        >
                            <SelectValue placeholder="Selecionar departamento…" />
                        </SelectTrigger>
                        <SelectContent>
                            {departments.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                    {d.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {errors.departmentId ? (
                        <p
                            id="ticket-department-error"
                            className="text-xs text-(--red)"
                        >
                            {errors.departmentId.message ??
                                "Selecione um departamento."}
                        </p>
                    ) : null}
                </div>
            </div>

            {/* Priority ─────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="ticket-priority"
                    className="text-sm font-medium text-(--ink)"
                >
                    Prioridade <span className="text-(--red)">*</span>
                </label>
                <Select
                    value={priority}
                    onValueChange={(v) =>
                        setValue("priority", v as TicketFormValues["priority"], {
                            shouldValidate: true,
                            shouldDirty: true,
                        })
                    }
                >
                    <SelectTrigger
                        id="ticket-priority"
                        aria-invalid={Boolean(errors.priority) || undefined}
                        aria-describedby={
                            errors.priority ? "ticket-priority-error" : undefined
                        }
                    >
                        <SelectValue placeholder="Selecionar prioridade…" />
                    </SelectTrigger>
                    <SelectContent>
                        {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                                {PRIORITY_LABELS_PT[p]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {errors.priority ? (
                    <p
                        id="ticket-priority-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.priority.message ?? "Selecione uma prioridade."}
                    </p>
                ) : null}
            </div>

            {/* Assignee (only if allowAssign) ──────────────── */}
            {allowAssign ? (
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="ticket-assignee"
                        className="text-sm font-medium text-(--ink)"
                    >
                        Atribuir a
                    </label>
                    <Select
                        value={assigneeId ?? undefined}
                        onValueChange={(v) =>
                            setValue("assigneeId", v || undefined, {
                                shouldValidate: true,
                                shouldDirty: true,
                            })
                        }
                    >
                        <SelectTrigger
                            id="ticket-assignee"
                            aria-invalid={Boolean(errors.assigneeId) || undefined}
                            aria-describedby={
                                errors.assigneeId
                                    ? "ticket-assignee-error"
                                    : undefined
                            }
                        >
                            <SelectValue placeholder="Sem atribuição…" />
                        </SelectTrigger>
                        <SelectContent>
                            {assignees.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                    {u.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {errors.assigneeId ? (
                        <p
                            id="ticket-assignee-error"
                            className="text-xs text-(--red)"
                        >
                            {errors.assigneeId.message ??
                                "Selecione um responsável válido."}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {/* Description ──────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="ticket-description"
                    className="text-sm font-medium text-(--ink)"
                >
                    Descrição detalhada <span className="text-(--red)">*</span>
                </label>
                <Textarea
                    id="ticket-description"
                    rows={6}
                    placeholder={
                        "Inclua passos para reproduzir, mensagens de erro e qualquer informação que ajude o time."
                    }
                    error={Boolean(errors.description)}
                    aria-describedby={
                        errors.description
                            ? "ticket-description-error"
                            : "ticket-description-hint"
                    }
                    {...register("description")}
                />
                {errors.description ? (
                    <p
                        id="ticket-description-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.description.message ??
                            "Descreva o problema com mais detalhes."}
                    </p>
                ) : (
                    <p
                        id="ticket-description-hint"
                        className="text-xs text-(--ink-3)"
                    >
                        {descriptionValue.length}/2000 caracteres
                    </p>
                )}
            </div>

            {/* Attachments ──────────────────────────────────── */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-(--ink)">Anexos</span>

                {uploadedFiles.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {uploadedFiles.map((a) => (
                            <AttachmentChip
                                key={a.id}
                                id={a.id}
                                name={a.name}
                                size={a.size}
                                mime={a.mime}
                                onRemove={removeAttachment}
                            />
                        ))}
                    </div>
                ) : null}

                <div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={UploadConstraints.allowedMime.join(",")}
                        className="sr-only"
                        onChange={(e) => {
                            void handleFilesSelected(e);
                        }}
                    />
                    <Button
                        type="button"
                        size="sm"
                        variant="default"
                        icon={<Paperclip />}
                        loading={uploading}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Anexar arquivo
                    </Button>
                </div>

                {errors.attachments ? (
                    <p className="text-xs text-(--red)">
                        {errors.attachments.message ??
                            "Verifique os anexos enviados."}
                    </p>
                ) : (
                    <p className="text-xs text-(--ink-3)">
                        Máx. 25 MiB por arquivo · png, jpg, pdf, xlsx, txt, log ·
                        até 10 anexos
                    </p>
                )}
            </div>

            {/* Submit ───────────────────────────────────────── */}
            <div className="flex justify-end gap-2 pt-2">
                <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={isSubmitting}
                >
                    Abrir chamado
                </Button>
            </div>
        </form>
    );
}

/** Re-export para conveniência da página consumidora. */
export type { CreateTicketInput };
