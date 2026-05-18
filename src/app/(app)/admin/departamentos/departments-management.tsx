/**
 * `DepartmentsManagement` — Client Component que renderiza a tabela de
 * departamentos e os controles administrativos da página
 * `/admin/departamentos`.
 *
 * Responsabilidades:
 *
 * 1. Renderizar a `DataTable` com colunas: `id` (UUID truncado em mono),
 *    `name` e botões de ação (`Editar`, `Excluir`).
 * 2. Expor um botão `Novo departamento` que abre um `Dialog` com input
 *    controlado para `name`. O submit chama `createDepartmentAction` —
 *    em sucesso, fecha o diálogo e dispara um toast de êxito; em erro,
 *    exibe um toast com a mensagem retornada (incluindo o
 *    `CONFLICT { field: "name" }` quando o nome já existe).
 * 3. Botão `Editar` reaproveita o mesmo `Dialog` em modo "renomear",
 *    chamando `updateDepartmentAction(id, name)` e atualizando a linha
 *    localmente em sucesso.
 * 4. Botão `Excluir` chama `deleteDepartmentAction`. O serviço rejeita
 *    com `IN_USE` quando há tickets ou usuários associados — a UI
 *    exibe a mensagem do servidor em um toast de erro, sugerindo
 *    reatribuição como alternativa.
 * 5. Usa `React.useTransition` para que cada Server Action emita um
 *    pending state visível (botões em `loading` enquanto a requisição
 *    está em voo) sem bloquear a UI.
 *
 * Estado local: mantemos uma cópia de `departments` (`useState`) porque
 * os Server Actions já chamam `revalidatePath("/admin/departamentos")`;
 * ao receber o resultado, atualizamos imediatamente o estado local
 * para refletir a mudança sem esperar a próxima navegação.
 *
 * Validação no cliente:
 *
 * - O campo `name` usa `required` + `minLength`/`maxLength` alinhados a
 *   `CreateDepartmentSchema`. A validação canônica acontece no servidor
 *   via Zod; o cliente apenas evita disparar requisições obviamente
 *   inválidas.
 *
 * Validates: R15.
 */

"use client";

import * as React from "react";

import { Pencil, Plus } from "lucide-react";

import {
    createDepartmentAction,
    deleteDepartmentAction,
    updateDepartmentAction,
} from "@/actions/admin";
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
import type { DepartmentRow } from "@/services/reads.service";
import { getErrorMessage } from "@/lib/error-messages";

export interface DepartmentsManagementProps {
    /** Departamentos carregados pelo Server Component pai. */
    initialDepartments: DepartmentRow[];
}

/**
 * Estado do diálogo de criação/edição.
 *
 * `mode === "create"` esconde a referência a um `id` específico; em
 * `"edit"` mantemos `id` para encaminhar à action de atualização.
 */
type DialogState =
    | { open: false }
    | { open: true; mode: "create"; name: string }
    | { open: true; mode: "edit"; id: string; name: string };

const CLOSED_DIALOG: DialogState = { open: false };

export function DepartmentsManagement({
    initialDepartments,
}: DepartmentsManagementProps): React.ReactElement {
    const [departments, setDepartments] = React.useState<DepartmentRow[]>(
        // Ordenação inicial estável por nome — o cache do servidor não
        // garante ordem específica.
        [...initialDepartments].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR"),
        ),
    );
    const [dialog, setDialog] = React.useState<DialogState>(CLOSED_DIALOG);
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [isSaving, startSaveTransition] = React.useTransition();

    function openCreate(): void {
        setDialog({ open: true, mode: "create", name: "" });
    }

    function openEdit(row: DepartmentRow): void {
        setDialog({ open: true, mode: "edit", id: row.id, name: row.name });
    }

    function closeDialog(): void {
        setDialog(CLOSED_DIALOG);
    }

    /**
     * Atualiza o `name` do diálogo controlado preservando o modo
     * corrente. Centraliza o handler do input para que `mode === "edit"`
     * mantenha o `id`.
     */
    function setDialogName(name: string): void {
        setDialog((prev) => {
            if (!prev.open) return prev;
            if (prev.mode === "create") {
                return { ...prev, name };
            }
            return { ...prev, name };
        });
    }

    async function handleDelete(id: string): Promise<void> {
        setPendingId(id);
        try {
            const result = await deleteDepartmentAction(id);
            if (result.ok) {
                setDepartments((prev) => prev.filter((d) => d.id !== id));
                toast({
                    variant: "success",
                    title: "Departamento excluído",
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível excluir o departamento",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingId(null);
        }
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        if (!dialog.open) return;
        const name = dialog.name.trim();

        if (dialog.mode === "create") {
            startSaveTransition(async () => {
                const result = await createDepartmentAction({ name });
                if (result.ok) {
                    setDepartments((prev) =>
                        [
                            ...prev,
                            { id: result.data.id, name: result.data.name },
                        ].sort((a, b) =>
                            a.name.localeCompare(b.name, "pt-BR"),
                        ),
                    );
                    toast({
                        variant: "success",
                        title: "Departamento criado",
                        description: result.data.name,
                    });
                    closeDialog();
                } else {
                    toast({
                        variant: "error",
                        title: "Não foi possível criar o departamento",
                        description: getErrorMessage(result.error),
                    });
                }
            });
            return;
        }

        // mode === "edit"
        const id = dialog.id;
        startSaveTransition(async () => {
            const result = await updateDepartmentAction({ id, name });
            if (result.ok) {
                setDepartments((prev) =>
                    prev
                        .map((d) =>
                            d.id === result.data.id
                                ? { ...d, name: result.data.name }
                                : d,
                        )
                        .sort((a, b) =>
                            a.name.localeCompare(b.name, "pt-BR"),
                        ),
                );
                toast({
                    variant: "success",
                    title: "Departamento atualizado",
                });
                closeDialog();
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível atualizar o departamento",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    const columns: DataTableColumn<DepartmentRow>[] = [
        {
            id: "name",
            header: "Nome",
            sortKey: "name",
            cell: (d) => (
                <span className="font-medium text-(--ink)">{d.name}</span>
            ),
        },
        {
            id: "id",
            header: "Identificador",
            cell: (d) => (
                <code
                    title={d.id}
                    className="rounded-(--r-1) bg-(--bg-sunk) px-1.5 py-0.5 font-mono text-xs text-(--ink-3)"
                >
                    {d.id.slice(0, 8)}…
                </code>
            ),
        },
        {
            id: "actions",
            header: "",
            width: "220px",
            cell: (d) => {
                const pending = pendingId === d.id;
                return (
                    <div className="flex justify-end gap-2">
                        <Button
                            size="sm"
                            variant="default"
                            icon={<Pencil />}
                            loading={pending}
                            onClick={() => openEdit(d)}
                        >
                            Editar
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            loading={pending}
                            onClick={() => void handleDelete(d.id)}
                        >
                            Excluir
                        </Button>
                    </div>
                );
            },
        },
    ];

    const dialogTitle =
        dialog.open && dialog.mode === "edit"
            ? "Renomear departamento"
            : "Novo departamento";
    const dialogDescription =
        dialog.open && dialog.mode === "edit"
            ? "Atualize o nome exibido na listagem de tickets, no formulário de novo chamado e nos perfis de usuário."
            : "Cadastre um departamento que aparecerá no formulário de abertura de chamados e no perfil de usuários.";
    const submitLabel =
        dialog.open && dialog.mode === "edit"
            ? "Salvar alterações"
            : "Criar departamento";
    const dialogName = dialog.open ? dialog.name : "";

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end">
                <Button
                    variant="primary"
                    icon={<Plus />}
                    onClick={openCreate}
                >
                    Novo departamento
                </Button>
            </div>

            <DataTable<DepartmentRow>
                columns={columns}
                rows={departments}
                rowKey={(d) => d.id}
            />

            <Dialog
                open={dialog.open}
                onOpenChange={(next) => {
                    if (!next) closeDialog();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{dialogTitle}</DialogTitle>
                        <DialogDescription>
                            {dialogDescription}
                        </DialogDescription>
                    </DialogHeader>

                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-4"
                    >
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="department-name"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Nome
                            </label>
                            <Input
                                id="department-name"
                                required
                                minLength={2}
                                maxLength={80}
                                placeholder="ex.: TI"
                                value={dialogName}
                                onChange={(e) =>
                                    setDialogName(e.target.value)
                                }
                                autoFocus
                            />
                            <p className="text-xs text-(--ink-3)">
                                De 2 a 80 caracteres. Deve ser único.
                            </p>
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="default"
                                onClick={closeDialog}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                loading={isSaving}
                            >
                                {submitLabel}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
