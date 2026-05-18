/**
 * `NewKbArticleForm` — Client Component que renderiza o formulário de
 * criação de artigos da Base de Conhecimento (R13.4, R13.5, R13.9).
 *
 * Por que existir e por que cliente?
 *
 * - Combina três responsabilidades naturalmente client-side: validação
 *   imediata via `react-hook-form` + `zodResolver` sobre o
 *   `CreateKbArticleSchema`, derivação automática do `slug` a partir do
 *   `title` (até o usuário editar manualmente o slug) e tradução do
 *   `ActionResult` em toasts + `router.push`.
 * - Mantém a página `/kb/novo` (Server Component) limpa: ela só carrega
 *   categorias, aplica RBAC e injeta este componente.
 *
 * Comportamento:
 *
 * 1. O slug é derivado automaticamente do título (slugify pt-BR
 *    consciente de acentuação) enquanto o usuário não editar o campo
 *    manualmente. Assim que ele tocar o `Input` de slug, paramos de
 *    sobrescrever — comportamento idêntico ao de geradores de slug em
 *    CMSs comuns. O hint deixa essa regra explícita em pt-BR.
 * 2. O toggle "Publicar imediatamente" defaulta para `true`. A ideia
 *    é que técnicos/admins normalmente publicam ao terminar a redação;
 *    desmarcar guarda como rascunho (`published=false`, R13.2).
 * 3. Em sucesso (`ActionResult.ok === true`): toast positivo +
 *    `router.push(/kb/{slug})`. A action já dispara
 *    `revalidatePath("/kb")`.
 * 4. Em erro: toast com a mensagem do servidor. Quando o erro vem com
 *    `field`, marcamos o `Input` correspondente como `error` para guiar
 *    a correção (caso típico: `CONFLICT { field: "slug" }` quando o
 *    slug já existe — R13.5).
 *
 * Acessibilidade:
 *
 * - Cada campo tem `<label htmlFor>` e `aria-describedby` apontando
 *   para hint ou mensagem de erro (mesmo padrão dos demais formulários
 *   do app).
 * - O checkbox "Publicar imediatamente" usa input nativo com label
 *   visível e `id` único; suficiente para leitores de tela e teclado
 *   sem depender de um primitivo `Switch` ainda não disponível.
 *
 * Validates: R13.4, R13.5, R13.9.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Image as ImageIcon, Video } from "lucide-react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";

import { createArticleAction, updateArticleAction } from "@/actions/kb";
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
import { getErrorMessage } from "@/lib/error-messages";
import {
    CreateKbArticleSchema,
    type CreateKbArticleInput,
} from "@/lib/schemas";

/**
 * Forma mínima de uma categoria da KB consumida pelo select. Casa com
 * `KbCategoryRow` mas tipamos localmente para evitar acoplar este
 * componente ao schema do Drizzle.
 */
interface KbCategoryOption {
    id: string;
    label: string;
}

export interface NewKbArticleFormProps {
    /** Categorias disponíveis para classificar o artigo. */
    categories: ReadonlyArray<KbCategoryOption>;
    /**
     * Valores iniciais para popular o formulário em modo edição. Quando
     * presentes, o componente alterna para "Salvar alterações" e chama
     * `updateArticleAction(originalSlug, …)` em vez de `createArticleAction`.
     */
    initialValues?: CreateKbArticleInput;
    /**
     * Slug original do artigo em edição. Necessário para a Server Action
     * de update localizar o registro caso o autor altere o `slug` no
     * formulário. Em modo "novo" deve ser `undefined`.
     */
    originalSlug?: string;
}

/** Tamanho máximo do slug, espelhando o `CreateKbArticleSchema.slug.max(120)`. */
const SLUG_MAX = 120;

/**
 * Converte um título em slug pt-BR seguro para URL, respeitando o regex
 * `/^[a-z0-9-]+$/` exigido pelo schema.
 *
 * Regras:
 *
 * 1. Normaliza para `NFD` e remove diacríticos (acentos), garantindo
 *    que "Configuração" → "configuracao".
 * 2. Lowercase e troca qualquer caractere fora de `[a-z0-9]` por `-`.
 * 3. Colapsa hifens consecutivos e remove os de borda.
 * 4. Trunca em `SLUG_MAX` para não estourar o limite do schema.
 *
 * Pure function — testável e determinística para o mesmo input.
 */
function slugify(text: string): string {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // diacríticos
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SLUG_MAX);
}

/** Campos do formulário que podem receber erro vindo do servidor. */
type ServerField = "slug" | "title" | "body" | "categoryId" | "published";

const SERVER_FIELDS: ReadonlySet<ServerField> = new Set([
    "slug",
    "title",
    "body",
    "categoryId",
    "published",
]);

function isServerField(value: string | undefined): value is ServerField {
    return value !== undefined && SERVER_FIELDS.has(value as ServerField);
}

export function NewKbArticleForm({
    categories,
    initialValues,
    originalSlug,
}: NewKbArticleFormProps): React.ReactElement {
    const router = useRouter();

    const isEdit = initialValues !== undefined && originalSlug !== undefined;

    /**
     * Em modo edição, o slug nunca deve ser sobrescrito automaticamente
     * a partir do título — o usuário já tinha um valor ao abrir o form.
     * Em modo criação, espelhamos o slug enquanto o usuário não tocar
     * o campo.
     */
    const [slugTouched, setSlugTouched] = React.useState(isEdit);

    /**
     * Campo com erro vindo do servidor (ex.: `CONFLICT { field: "slug" }`).
     * Limpado assim que o usuário começa a editar o campo problemático
     * para manter o feedback honesto.
     */
    const [serverErrorField, setServerErrorField] =
        React.useState<ServerField | null>(null);

    /**
     * Indica que um upload de mídia (imagem ou vídeo) está em curso —
     * bloqueia os botões da toolbar e mostra estado de loading. Não
     * impede o submit do formulário em si: o usuário pode estar com
     * uma imagem subindo enquanto digita o resto do texto.
     */
    const [mediaUploading, setMediaUploading] = React.useState<
        false | "image" | "video"
    >(false);

    /**
     * Refs dos `<input type="file">` ocultos. Ao clicar nos botões
     * "Imagem"/"Vídeo" da toolbar, dispara um `click()` programático no
     * input correspondente.
     */
    const imageInputRef = React.useRef<HTMLInputElement | null>(null);
    const videoInputRef = React.useRef<HTMLInputElement | null>(null);

    /**
     * Ref do textarea — usada para descobrir a posição do cursor e
     * inserir o markdown da mídia no lugar certo após o upload.
     */
    const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        getValues,
        formState: { errors, isSubmitting },
    } = useForm<CreateKbArticleInput>({
        resolver: zodResolver(
            CreateKbArticleSchema,
        ) as Resolver<CreateKbArticleInput>,
        defaultValues: initialValues ?? {
            slug: "",
            title: "",
            body: "",
            categoryId: "",
            published: true,
        },
    });

    // Campos espelhados no DOM (Selects do Radix exigem valor controlado).
    const categoryId = watch("categoryId");
    const titleValue = watch("title") ?? "";
    const slugValue = watch("slug") ?? "";
    const bodyValue = watch("body") ?? "";
    const publishedValue = watch("published") ?? false;

    /**
     * Mantém o slug sincronizado com o título enquanto o usuário não
     * tiver editado o slug manualmente. Usar um `useEffect` em vez de
     * derivar inline garante que o valor persista no `react-hook-form`
     * e seja submetido junto com o resto do formulário.
     */
    React.useEffect(() => {
        if (slugTouched) return;
        const derived = slugify(titleValue);
        if (derived !== getValues("slug")) {
            setValue("slug", derived, { shouldValidate: false });
        }
    }, [titleValue, slugTouched, setValue, getValues]);

    function clearServerErrorIfMatches(field: ServerField): void {
        if (serverErrorField === field) {
            setServerErrorField(null);
        }
    }

    /**
     * Insere `text` na posição corrente do cursor no textarea (ou ao
     * final, quando o textarea ainda não está focado). Atualiza o RHF
     * via `setValue` para que a validação Zod e o submit reflitam o
     * conteúdo novo. Devolve o foco ao textarea com o cursor logo
     * depois do trecho inserido para que o usuário possa continuar
     * digitando sem interrupção.
     */
    function insertAtCursor(text: string): void {
        const ta = bodyRef.current;
        const current = getValues("body") ?? "";

        if (!ta) {
            // Fallback: anexa ao final + nova linha de respiro.
            const next =
                current.length > 0 && !current.endsWith("\n")
                    ? `${current}\n${text}\n`
                    : `${current}${text}\n`;
            setValue("body", next, { shouldDirty: true, shouldValidate: true });
            return;
        }

        const start = ta.selectionStart ?? current.length;
        const end = ta.selectionEnd ?? current.length;
        // Quando inserimos numa posição que não é início de linha,
        // adicionamos uma quebra antes do trecho para garantir que
        // imagens/vídeos não fiquem inline com o parágrafo anterior.
        const needsLeadingBreak =
            start > 0 && current[start - 1] !== "\n" && current[start - 1] !== undefined;
        const prefix = needsLeadingBreak ? "\n" : "";
        const insert = `${prefix}${text}\n`;
        const next = current.slice(0, start) + insert + current.slice(end);

        setValue("body", next, { shouldDirty: true, shouldValidate: true });

        // Reposiciona o cursor depois do trecho inserido. `requestAnimationFrame`
        // espera o React aplicar o novo `value`, evitando que a seleção
        // seja reescrita de volta para a posição antiga.
        const cursor = start + insert.length;
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(cursor, cursor);
        });
    }

    /**
     * Faz upload do arquivo via `POST /api/uploads`, devolvendo a
     * payload do servidor (`{ url, name, mime, ... }`). Em caso de
     * erro, dispara um toast `error` com a mensagem retornada pelo
     * handler e relança a exceção para que o caller pare o fluxo de
     * inserção.
     */
    async function uploadMedia(file: File): Promise<{
        url: string;
        name: string;
        mime: string;
    }> {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/uploads", {
            method: "POST",
            body: fd,
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => null)) as
                | { code?: string; message?: string }
                | null;
            const description =
                data?.message ?? "Não foi possível enviar o arquivo.";
            toast({
                variant: "error",
                title: "Falha no upload",
                description,
            });
            throw new Error(description);
        }
        return (await res.json()) as {
            url: string;
            name: string;
            mime: string;
        };
    }

    /**
     * Handler do `<input type="file">` de imagens. Aceita um arquivo,
     * faz o upload e injeta o markdown `![alt](url)` na posição do
     * cursor. O `value` do input é zerado depois para permitir
     * selecionar a mesma imagem duas vezes seguidas (o navegador
     * normalmente ignora `change` quando o nome de arquivo não muda).
     */
    async function handleImageSelected(
        e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setMediaUploading("image");
        try {
            const uploaded = await uploadMedia(file);
            const alt = file.name.replace(/\.[^.]+$/, "");
            insertAtCursor(`![${alt}](${uploaded.url})`);
            toast({
                variant: "success",
                title: "Imagem inserida",
                description: file.name,
            });
        } catch {
            // toast já foi disparado em `uploadMedia`.
        } finally {
            setMediaUploading(false);
        }
    }

    /**
     * Handler do `<input type="file">` de vídeos. Faz o upload e injeta
     * uma tag `<video>` HTML com a URL — markdown puro não tem sintaxe
     * para vídeos, mas o sanitize do renderizador foi configurado para
     * permitir `<video>`/`<source>`/`controls`.
     */
    async function handleVideoSelected(
        e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setMediaUploading("video");
        try {
            const uploaded = await uploadMedia(file);
            const tag = `<video controls src="${uploaded.url}"></video>`;
            insertAtCursor(tag);
            toast({
                variant: "success",
                title: "Vídeo inserido",
                description: file.name,
            });
        } catch {
            // toast já foi disparado em `uploadMedia`.
        } finally {
            setMediaUploading(false);
        }
    }

    async function onValid(values: CreateKbArticleInput): Promise<void> {
        const result = isEdit
            ? await updateArticleAction(originalSlug!, values)
            : await createArticleAction(values);
        if (result.ok) {
            toast({
                variant: "success",
                title: isEdit ? "Artigo atualizado" : "Artigo criado",
                description: result.data.published
                    ? `“${result.data.title}” foi publicado.`
                    : `“${result.data.title}” foi salvo como rascunho.`,
            });
            // Redireciona para o detalhe (pode ter mudado o slug em edição).
            // A action já revalidou `/kb` e os slugs envolvidos.
            router.push(`/kb/${result.data.slug}`);
            return;
        }

        if (isServerField(result.error.field)) {
            setServerErrorField(result.error.field);
        }
        toast({
            variant: "error",
            title: isEdit
                ? "Não foi possível salvar as alterações"
                : "Não foi possível criar o artigo",
            description: getErrorMessage(result.error),
        });
    }

    const titleHasError = Boolean(errors.title) || serverErrorField === "title";
    const slugHasError = Boolean(errors.slug) || serverErrorField === "slug";
    const bodyHasError = Boolean(errors.body) || serverErrorField === "body";
    const categoryHasError =
        Boolean(errors.categoryId) || serverErrorField === "categoryId";

    return (
        <form
            noValidate
            onSubmit={handleSubmit(onValid)}
            className="flex flex-col gap-5"
        >
            {/* Title ──────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="kb-title"
                    className="text-sm font-medium text-(--ink)"
                >
                    Título <span className="text-(--red)">*</span>
                </label>
                <Input
                    id="kb-title"
                    placeholder="Ex.: Como redefinir a senha do AD"
                    error={titleHasError}
                    aria-describedby={
                        errors.title ? "kb-title-error" : "kb-title-hint"
                    }
                    {...register("title", {
                        onChange: () => clearServerErrorIfMatches("title"),
                    })}
                />
                {errors.title ? (
                    <p id="kb-title-error" className="text-xs text-(--red)">
                        {errors.title.message ?? "Informe um título válido."}
                    </p>
                ) : (
                    <p id="kb-title-hint" className="text-xs text-(--ink-3)">
                        {titleValue.length < 5
                            ? `Mínimo 5 caracteres (${titleValue.length}/5)`
                            : `${titleValue.length}/160 caracteres`}
                    </p>
                )}
            </div>

            {/* Slug ───────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="kb-slug"
                    className="text-sm font-medium text-(--ink)"
                >
                    Slug <span className="text-(--red)">*</span>
                </label>
                <Input
                    id="kb-slug"
                    placeholder="redefinir-senha-ad"
                    error={slugHasError}
                    aria-describedby={
                        errors.slug ? "kb-slug-error" : "kb-slug-hint"
                    }
                    {...register("slug", {
                        onChange: () => {
                            // Primeira edição manual desabilita o
                            // espelhamento automático a partir do título.
                            if (!slugTouched) setSlugTouched(true);
                            clearServerErrorIfMatches("slug");
                        },
                    })}
                />
                {errors.slug ? (
                    <p id="kb-slug-error" className="text-xs text-(--red)">
                        {errors.slug.message ??
                            "Use apenas letras minúsculas, números e hifens."}
                    </p>
                ) : (
                    <p id="kb-slug-hint" className="text-xs text-(--ink-3)">
                        Gerado automaticamente a partir do título. Você pode
                        editar; aceita apenas letras minúsculas, números e
                        hifens. ({slugValue.length}/{SLUG_MAX})
                    </p>
                )}
            </div>

            {/* Category ───────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="kb-category"
                    className="text-sm font-medium text-(--ink)"
                >
                    Categoria <span className="text-(--red)">*</span>
                </label>
                <Select
                    value={categoryId || undefined}
                    onValueChange={(v) => {
                        setValue("categoryId", v, {
                            shouldValidate: true,
                            shouldDirty: true,
                        });
                        clearServerErrorIfMatches("categoryId");
                    }}
                >
                    <SelectTrigger
                        id="kb-category"
                        aria-invalid={categoryHasError || undefined}
                        aria-describedby={
                            errors.categoryId ? "kb-category-error" : undefined
                        }
                    >
                        <SelectValue placeholder="Selecionar categoria…" />
                    </SelectTrigger>
                    <SelectContent>
                        {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                                {c.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {errors.categoryId ? (
                    <p id="kb-category-error" className="text-xs text-(--red)">
                        {errors.categoryId.message ??
                            "Selecione uma categoria."}
                    </p>
                ) : null}
            </div>

            {/* Body ───────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                    <label
                        htmlFor="kb-body"
                        className="text-sm font-medium text-(--ink)"
                    >
                        Corpo (Markdown){" "}
                        <span className="text-(--red)">*</span>
                    </label>
                    {/* Toolbar de mídia. Os inputs de arquivo são
                        ocultos; cliques nos botões disparam um
                        `click()` programático nos respectivos refs. O
                        accept usa MIMEs reais para que o seletor do
                        SO já filtre por tipo. */}
                    <div className="flex items-center gap-2">
                        <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            className="hidden"
                            onChange={handleImageSelected}
                        />
                        <input
                            ref={videoInputRef}
                            type="file"
                            accept="video/mp4,video/webm"
                            className="hidden"
                            onChange={handleVideoSelected}
                        />
                        <Button
                            type="button"
                            variant="default"
                            size="sm"
                            icon={<ImageIcon />}
                            loading={mediaUploading === "image"}
                            disabled={mediaUploading !== false}
                            onClick={() => imageInputRef.current?.click()}
                        >
                            Imagem
                        </Button>
                        <Button
                            type="button"
                            variant="default"
                            size="sm"
                            icon={<Video />}
                            loading={mediaUploading === "video"}
                            disabled={mediaUploading !== false}
                            onClick={() => videoInputRef.current?.click()}
                        >
                            Vídeo
                        </Button>
                    </div>
                </div>
                <Textarea
                    id="kb-body"
                    rows={18}
                    placeholder={
                        "Escreva o procedimento em Markdown.\n\n" +
                        "Exemplos:\n" +
                        "## Passo 1\n" +
                        "Texto explicativo…\n\n" +
                        "- Item de lista\n" +
                        "- `comando`"
                    }
                    error={bodyHasError}
                    aria-describedby={
                        errors.body ? "kb-body-error" : "kb-body-hint"
                    }
                    className="min-h-[400px] font-mono text-[0.9375rem] leading-6"
                    {...register("body", {
                        onChange: () => clearServerErrorIfMatches("body"),
                    })}
                    ref={(el) => {
                        // Encadeia o ref do RHF e o ref local. O RHF
                        // expõe o callback ref via `register("body").ref`,
                        // que precisa ser invocado para que `setValue`,
                        // validação e foco programático continuem
                        // funcionando.
                        register("body").ref(el);
                        bodyRef.current = el;
                    }}
                />
                {errors.body ? (
                    <p id="kb-body-error" className="text-xs text-(--red)">
                        {errors.body.message ??
                            "Informe o conteúdo do artigo."}
                    </p>
                ) : (
                    <p id="kb-body-hint" className="text-xs text-(--ink-3)">
                        Mínimo 10 caracteres. Use os botões acima para
                        adicionar imagens (PNG, JPG, GIF, WebP) ou vídeos
                        (MP4, WebM) — limite de 25 MiB por arquivo (
                        {bodyValue.length} caracteres).
                    </p>
                )}
            </div>

            {/* Published toggle ───────────────────────────── */}
            <div className="flex items-start gap-3 rounded-(--r-3) border border-(--line) bg-(--bg-elev) p-4">
                <input
                    id="kb-published"
                    type="checkbox"
                    checked={publishedValue}
                    onChange={(e) =>
                        setValue("published", e.target.checked, {
                            shouldDirty: true,
                        })
                    }
                    className="mt-0.5 size-4 cursor-pointer accent-(--accent)"
                />
                <div className="flex flex-1 flex-col gap-1">
                    <label
                        htmlFor="kb-published"
                        className="cursor-pointer text-sm font-medium text-(--ink)"
                    >
                        Publicar imediatamente
                    </label>
                    <p className="text-xs text-(--ink-3)">
                        Quando desmarcado, o artigo é salvo como rascunho e
                        fica visível apenas para você até a publicação.
                    </p>
                </div>
            </div>

            {/* Submit ─────────────────────────────────────── */}
            <div className="flex justify-end gap-2 pt-2">
                <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    loading={isSubmitting}
                >
                    {isEdit
                        ? "Salvar alterações"
                        : publishedValue
                            ? "Publicar artigo"
                            : "Salvar rascunho"}
                </Button>
            </div>
        </form>
    );
}
