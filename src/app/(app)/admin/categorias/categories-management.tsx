/**
 * `CategoriesManagement` — Client Component que renderiza a tabela de
 * categorias e os controles administrativos da página `/admin/categorias`.
 *
 * Responsabilidades:
 *
 * 1. Renderizar a `DataTable` com colunas: `id`, `label`, `sub`, ícone
 *    (preview via `CategoryChip`), badge de ativo/inativo e botões de
 *    ação (`Desativar` e `Excluir`).
 * 2. Expor um botão `Nova categoria` que abre um `Dialog` com formulário
 *    controlado (`id`, `label`, `sub`, `icon`). O submit chama
 *    `createCategoryAction` — em sucesso, fecha o diálogo e dispara um
 *    toast de êxito; em erro, exibe um toast com a mensagem retornada
 *    (incluindo o `CONFLICT { field: "id" }` quando o `id` já existe).
 * 3. Botão `Desativar` chama `deactivateCategoryAction` (R15.6) e
 *    atualiza a linha localmente para refletir `active=false`. O botão
 *    fica oculto quando a categoria já está inativa.
 * 4. Botão `Excluir` chama `deleteCategoryAction` (R15.7). O serviço
 *    rejeita com `IN_USE` quando há tickets associados — a UI exibe a
 *    mensagem do servidor em um toast de erro, sugerindo desativação
 *    como alternativa.
 * 5. Usa `React.useTransition` para que cada Server Action emita um
 *    pending state visível (botões em `loading` enquanto a requisição
 *    está em voo) sem bloquear a UI.
 *
 * Estado local: mantemos uma cópia de `categories` (`useState`) porque os
 * Server Actions já chamam `revalidatePath("/admin/categorias")`; ao
 * receber o resultado, atualizamos imediatamente o estado local para
 * refletir a mudança sem esperar a próxima navegação.
 *
 * Validação no cliente:
 *
 * - Os campos obrigatórios usam `required` + `minLength`/`maxLength`
 *   alinhados a `CreateCategorySchema`. A validação canônica acontece
 *   no servidor via Zod (R15.5); o cliente apenas evita disparar
 *   requisições obviamente inválidas.
 *
 * Validates: R15.4, R15.5, R15.6, R15.7.
 */

"use client";

import * as React from "react";

import { Plus } from "lucide-react";

import {
    createCategoryAction,
    deactivateCategoryAction,
    deleteCategoryAction,
} from "@/actions/admin";
import { CategoryChip } from "@/components/domain/category-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-messages";
import type { CategoryRow } from "@/services/reads.service";

export interface CategoriesManagementProps {
    /** Categorias carregadas pelo Server Component pai (ativas e inativas). */
    initialCategories: CategoryRow[];
}

interface CreateFormState {
    id: string;
    label: string;
    sub: string;
    icon: string;
}

const EMPTY_FORM: CreateFormState = {
    id: "",
    label: "",
    sub: "",
    icon: "",
};

export function CategoriesManagement({
    initialCategories,
}: CategoriesManagementProps): React.ReactElement {
    // Cópia local para refletir mutações (criação, desativação, exclusão)
    // sem aguardar navegação. O Server Action também chama
    // `revalidatePath`, então a próxima navegação trará a mesma lista.
    const [categories, setCategories] =
        React.useState<CategoryRow[]>(initialCategories);
    const [createOpen, setCreateOpen] = React.useState(false);
    const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [isCreating, startCreateTransition] = React.useTransition();

    function resetForm(): void {
        setForm(EMPTY_FORM);
    }

    async function handleDeactivate(id: string): Promise<void> {
        setPendingId(id);
        try {
            const result = await deactivateCategoryAction(id);
            if (result.ok) {
                setCategories((prev) =>
                    prev.map((c) =>
                        c.id === id ? { ...c, active: false } : c,
                    ),
                );
                toast({
                    variant: "success",
                    title: "Categoria desativada",
                    description: `Identificador: ${id}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível desativar a categoria",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingId(null);
        }
    }

    async function handleDelete(id: string): Promise<void> {
        setPendingId(id);
        try {
            const result = await deleteCategoryAction(id);
            if (result.ok) {
                setCategories((prev) => prev.filter((c) => c.id !== id));
                toast({
                    variant: "success",
                    title: "Categoria excluída",
                    description: `Identificador: ${id}.`,
                });
            } else {
                // Cobre R15.7: serviço retorna `IN_USE` quando há tickets
                // associados; a mensagem em pt-BR já sugere desativação.
                toast({
                    variant: "error",
                    title: "Não foi possível excluir a categoria",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingId(null);
        }
    }

    function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        const payload = {
            id: form.id.trim(),
            label: form.label.trim(),
            sub: form.sub.trim(),
            icon: form.icon.trim(),
        };

        startCreateTransition(async () => {
            const result = await createCategoryAction(payload);
            if (result.ok) {
                setCategories((prev) =>
                    [
                        ...prev,
                        {
                            id: result.data.id,
                            label: payload.label,
                            sub: payload.sub,
                            icon: payload.icon,
                            active: true,
                        },
                    ].sort((a, b) =>
                        a.label.localeCompare(b.label, "pt-BR"),
                    ),
                );
                toast({
                    variant: "success",
                    title: "Categoria criada",
                    description: result.data.id,
                });
                setCreateOpen(false);
                resetForm();
            } else {
                // R15.5: conflito de `id` retorna `CONFLICT { field: "id" }`
                // — a mensagem do serviço já é amigável.
                toast({
                    variant: "error",
                    title: "Não foi possível criar a categoria",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    const columns: DataTableColumn<CategoryRow>[] = [
        {
            id: "id",
            header: "ID",
            sortKey: "id",
            cell: (c) => (
                <code className="rounded-(--r-1) bg-(--bg-sunk) px-1.5 py-0.5 font-mono text-xs text-(--ink-2)">
                    {c.id}
                </code>
            ),
        },
        {
            id: "label",
            header: "Rótulo",
            sortKey: "label",
            cell: (c) => (
                <span className="font-medium text-(--ink)">{c.label}</span>
            ),
        },
        {
            id: "sub",
            header: "Subtítulo",
            cell: (c) => <span className="text-(--ink-2)">{c.sub}</span>,
        },
        {
            id: "preview",
            header: "Pré-visualização",
            cell: (c) => (
                <CategoryChip icon={c.icon} label={c.label} sub={c.sub} />
            ),
        },
        {
            id: "active",
            header: "Status",
            cell: (c) =>
                c.active ? (
                    <Badge tone="green">Ativa</Badge>
                ) : (
                    <Badge tone="grey">Inativa</Badge>
                ),
        },
        {
            id: "actions",
            header: "",
            width: "220px",
            cell: (c) => {
                const pending = pendingId === c.id;
                return (
                    <div className="flex justify-end gap-2">
                        {c.active ? (
                            <Button
                                size="sm"
                                variant="default"
                                loading={pending}
                                onClick={() => void handleDeactivate(c.id)}
                            >
                                Desativar
                            </Button>
                        ) : null}
                        <Button
                            size="sm"
                            variant="danger"
                            loading={pending}
                            onClick={() => void handleDelete(c.id)}
                        >
                            Excluir
                        </Button>
                    </div>
                );
            },
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button
                    variant="primary"
                    icon={<Plus />}
                    onClick={() => {
                        resetForm();
                        setCreateOpen(true);
                    }}
                >
                    Nova categoria
                </Button>
            </div>

            <DataTable<CategoryRow>
                columns={columns}
                rows={categories}
                rowKey={(c) => c.id}
            />

            <Dialog
                open={createOpen}
                onOpenChange={(next) => {
                    setCreateOpen(next);
                    if (!next) resetForm();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova categoria</DialogTitle>
                        <DialogDescription>
                            Cadastre uma categoria que aparecerá no formulário
                            de abertura de chamados. O identificador deve ser
                            único e estável.
                        </DialogDescription>
                    </DialogHeader>

                    <form
                        onSubmit={handleCreateSubmit}
                        className="flex flex-col gap-4"
                    >
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="category-id"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Identificador
                            </label>
                            <Input
                                id="category-id"
                                required
                                minLength={1}
                                maxLength={40}
                                placeholder="ex.: hardware"
                                value={form.id}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        id: e.target.value,
                                    }))
                                }
                            />
                            <p className="text-xs text-(--ink-3)">
                                Curto e estável (até 40 caracteres). Usado em
                                URLs e referências internas.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="category-label"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Rótulo
                            </label>
                            <Input
                                id="category-label"
                                required
                                minLength={1}
                                maxLength={80}
                                placeholder="ex.: Hardware"
                                value={form.label}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        label: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="category-sub"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Subtítulo
                            </label>
                            <Input
                                id="category-sub"
                                required
                                minLength={1}
                                maxLength={120}
                                placeholder="ex.: Periféricos, monitores e CPUs"
                                value={form.sub}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        sub: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="category-icon"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Ícone
                            </label>
                            <Input
                                id="category-icon"
                                required
                                minLength={1}
                                placeholder="ex.: monitor, package, cog, wifi, key, mail, info, code"
                                value={form.icon}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        icon: e.target.value,
                                    }))
                                }
                            />
                            <p className="text-xs text-(--ink-3)">
                                Nome de um ícone Lucide aceito pelo
                                CategoryChip. Nomes desconhecidos caem no
                                ícone genérico.
                            </p>
                            {form.icon.trim().length > 0 ||
                                form.label.trim().length > 0 ? (
                                <div className="mt-1">
                                    <CategoryChip
                                        icon={form.icon.trim()}
                                        label={
                                            form.label.trim() || "Pré-visualização"
                                        }
                                        sub={
                                            form.sub.trim() || undefined
                                        }
                                    />
                                </div>
                            ) : null}
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="default"
                                onClick={() => {
                                    setCreateOpen(false);
                                    resetForm();
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                loading={isCreating}
                            >
                                Criar categoria
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
