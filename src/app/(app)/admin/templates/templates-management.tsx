/**
 * `TemplatesManagement` — CRUD de templates de ticket.
 *
 * Lista os templates existentes em uma `DataTable`, com botão de
 * criar/editar via dialog e desativar inline. Reusa o padrão visual
 * do admin de usuários.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Pencil, Plus, Trash2 } from "lucide-react";

import {
    createTemplateAction,
    deleteTemplateAction,
    updateTemplateAction,
} from "@/actions/ticket-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { getErrorMessage } from "@/lib/error-messages";
import type { Priority } from "@/types/domain";

export interface TemplateRow {
    id: string;
    name: string;
    title: string;
    description: string;
    priority: Priority;
    categoryId: string;
    departmentId: string | null;
    active: boolean;
}

export interface TemplatesManagementProps {
    templates: TemplateRow[];
    categories: { id: string; label: string }[];
    departments: { id: string; name: string }[];
}

interface FormState {
    name: string;
    title: string;
    description: string;
    priority: Priority;
    categoryId: string;
    departmentId: string;
    active: boolean;
}

const EMPTY_FORM: FormState = {
    name: "",
    title: "",
    description: "",
    priority: "media",
    categoryId: "",
    departmentId: "",
    active: true,
};

export function TemplatesManagement({
    templates,
    categories,
    departments,
}: TemplatesManagementProps) {
    const router = useRouter();
    const [editing, setEditing] = React.useState<TemplateRow | null>(null);
    const [open, setOpen] = React.useState(false);
    const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
    const [pending, startTransition] = React.useTransition();
    const [deletingId, setDeletingId] = React.useState<string | null>(null);

    const categoryById = React.useMemo(() => {
        const m = new Map<string, string>();
        for (const c of categories) m.set(c.id, c.label);
        return m;
    }, [categories]);

    function openCreate(): void {
        setEditing(null);
        setForm(EMPTY_FORM);
        setOpen(true);
    }

    function openEdit(t: TemplateRow): void {
        setEditing(t);
        setForm({
            name: t.name,
            title: t.title,
            description: t.description,
            priority: t.priority,
            categoryId: t.categoryId,
            departmentId: t.departmentId ?? "",
            active: t.active,
        });
        setOpen(true);
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        const payload = {
            name: form.name.trim(),
            title: form.title.trim(),
            description: form.description.trim(),
            priority: form.priority,
            categoryId: form.categoryId,
            departmentId:
                form.departmentId.length > 0 ? form.departmentId : null,
            active: form.active,
        };
        startTransition(async () => {
            const result = editing
                ? await updateTemplateAction(editing.id, payload)
                : await createTemplateAction(payload);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: editing ? "Modelo atualizado" : "Modelo criado",
                });
                setOpen(false);
                setEditing(null);
                setForm(EMPTY_FORM);
                router.refresh();
            } else {
                toast({
                    variant: "error",
                    title: "Falha",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    async function handleDelete(id: string): Promise<void> {
        if (!confirm("Tem certeza que deseja excluir este modelo?")) return;
        setDeletingId(id);
        try {
            const result = await deleteTemplateAction(id);
            if (result.ok) {
                toast({ variant: "success", title: "Modelo excluído" });
                router.refresh();
            } else {
                toast({
                    variant: "error",
                    title: "Falha",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setDeletingId(null);
        }
    }

    const columns: DataTableColumn<TemplateRow>[] = [
        {
            id: "name",
            header: "Nome",
            sortKey: "name",
            cell: (t) => (
                <span className="font-medium text-(--ink)">{t.name}</span>
            ),
        },
        {
            id: "title",
            header: "Título do ticket",
            cell: (t) => (
                <span className="truncate text-(--ink-2)">{t.title}</span>
            ),
        },
        {
            id: "priority",
            header: "Prioridade",
            cell: (t) => (
                <span className="text-(--ink-2)">
                    {PRIORITY_LABELS_PT[t.priority]}
                </span>
            ),
        },
        {
            id: "category",
            header: "Categoria",
            cell: (t) => (
                <span className="text-(--ink-2)">
                    {categoryById.get(t.categoryId) ?? t.categoryId}
                </span>
            ),
        },
        {
            id: "active",
            header: "Status",
            cell: (t) =>
                t.active ? (
                    <Badge tone="green">Ativo</Badge>
                ) : (
                    <Badge tone="grey">Inativo</Badge>
                ),
        },
        {
            id: "actions",
            header: "",
            width: "180px",
            cell: (t) => (
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="default"
                        icon={<Pencil />}
                        onClick={() => openEdit(t)}
                    >
                        Editar
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 />}
                        loading={deletingId === t.id}
                        onClick={() => void handleDelete(t.id)}
                    >
                        Excluir
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button variant="primary" icon={<Plus />} onClick={openCreate}>
                    Novo modelo
                </Button>
            </div>

            <DataTable<TemplateRow>
                columns={columns}
                rows={templates}
                rowKey={(t) => t.id}
            />

            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setEditing(null);
                        setForm(EMPTY_FORM);
                    }
                }}
            >
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? "Editar modelo" : "Novo modelo"}
                        </DialogTitle>
                    </DialogHeader>

                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-4"
                    >
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-(--ink)">
                                Nome do modelo
                            </label>
                            <Input
                                required
                                minLength={2}
                                maxLength={80}
                                value={form.name}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        name: e.target.value,
                                    }))
                                }
                                placeholder="Ex.: Reset de senha"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-(--ink)">
                                Título sugerido do ticket
                            </label>
                            <Input
                                required
                                minLength={5}
                                maxLength={120}
                                value={form.title}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        title: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-(--ink)">
                                Descrição base
                            </label>
                            <Textarea
                                required
                                rows={5}
                                minLength={10}
                                maxLength={2000}
                                value={form.description}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        description: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-medium text-(--ink)">
                                    Prioridade
                                </label>
                                <Select
                                    value={form.priority}
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            priority: v as Priority,
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PRIORITIES.map((p) => (
                                            <SelectItem key={p} value={p}>
                                                {PRIORITY_LABELS_PT[p]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-medium text-(--ink)">
                                    Categoria
                                </label>
                                <Select
                                    value={form.categoryId}
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            categoryId: v,
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecionar…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map((c) => (
                                            <SelectItem
                                                key={c.id}
                                                value={c.id}
                                            >
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-(--ink)">
                                Departamento (opcional)
                            </label>
                            <Select
                                value={form.departmentId}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        departmentId: v,
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Sem departamento padrão" />
                                </SelectTrigger>
                                <SelectContent>
                                    {departments.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                            {d.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.active}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        active: e.target.checked,
                                    }))
                                }
                                className="size-4 rounded border-(--line) text-(--accent)"
                            />
                            Ativo (visível no formulário de novo ticket)
                        </label>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="default"
                                onClick={() => setOpen(false)}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                loading={pending}
                            >
                                {editing ? "Salvar" : "Criar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
