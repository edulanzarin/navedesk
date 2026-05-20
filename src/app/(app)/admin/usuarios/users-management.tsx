/**
 * `UsersManagement` — Client Component que renderiza a tabela de
 * usuários e os controles administrativos da página `/admin/usuarios`.
 *
 * Responsabilidades:
 *
 * 1. Renderizar a `DataTable` com colunas: nome, email, papel
 *    (`Select` que dispara `updateUserRoleAction` no `onValueChange`),
 *    departamento, badge de ativo/inativo e botão de
 *    desativar/reativar.
 * 2. Expor um botão `Novo usuário` que abre um `Dialog` com formulário
 *    controlado. O submit chama `createUserAction` — em sucesso, fecha
 *    o diálogo e dispara um toast de êxito; em erro, exibe um toast com
 *    a mensagem retornada (incluindo o `CONFLICT { field: "email" }`
 *    de R14.3).
 * 3. Usar `React.useTransition` para que cada Server Action emita um
 *    pending state visível (botões em `loading` enquanto a requisição
 *    está em voo) sem bloquear a UI.
 *
 * Reativações (após desativação) reaproveitam `updateUserRoleAction`
 * apenas como gatilho de revalidação — para alternar `active=true/false`
 * o domínio expõe `deactivateUserAction`. Aqui usamos uma cópia local
 * de `users` (`useState`) porque os Server Actions do admin já chamam
 * `revalidatePath("/admin/usuarios")` em sucesso; ao retornar uma
 * `UserRow` atualizada, atualizamos imediatamente o estado local para
 * refletir a mudança sem esperar a próxima navegação.
 *
 * Notas:
 * - Reativação não está exposta no domínio atual (a função
 *   `deactivateUserAction` apenas desativa). A UI mostra um botão
 *   "Reativar" desabilitado com tooltip via `title` para tornar claro
 *   que a operação ainda não está disponível, mantendo a interface
 *   honesta sobre as capacidades do back-end (R20.1).
 *
 * Validates: R14.
 */

"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Plus, Search } from "lucide-react";

import {
    createUserAction,
    deactivateUserAction,
    updateUserRoleAction,
} from "@/actions/admin";
import { Avatar } from "@/components/ui/avatar";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import type { UserRow } from "@/db/repositories/users.repo";
import { ROLES, ROLE_LABELS_PT } from "@/lib/constants";
import { getErrorMessage } from "@/lib/error-messages";
import type { Role } from "@/types/domain";

interface DepartmentRow {
    id: string;
    name: string;
}

export interface UsersManagementProps {
    users: UserRow[];
    departments: DepartmentRow[];
    currentUserId: string;
    currentQuery: string;
    hasPrevious: boolean;
    nextCursor: string | null;
}

interface CreateFormState {
    name: string;
    email: string;
    password: string;
    role: Role;
    departmentId: string;
}

const EMPTY_FORM: CreateFormState = {
    name: "",
    email: "",
    password: "",
    role: "solicitante",
    departmentId: "",
};

export function UsersManagement({
    users: initialUsers,
    departments,
    currentUserId,
    currentQuery,
    hasPrevious,
    nextCursor,
}: UsersManagementProps): React.ReactElement {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Cópia local para refletir mutações (alteração de papel, desativação)
    // sem precisar aguardar navegação. O Server Action também já chama
    // `revalidatePath`, então a próxima navegação trará a mesma lista.
    const [users, setUsers] = React.useState<UserRow[]>(initialUsers);
    // Quando paginação ou busca mudam, a página recarrega via Server
    // Component e `initialUsers` chega novo. Sincroniza o estado local.
    React.useEffect(() => {
        setUsers(initialUsers);
    }, [initialUsers]);

    const [searchInput, setSearchInput] = React.useState(currentQuery);
    React.useEffect(() => {
        setSearchInput(currentQuery);
    }, [currentQuery]);

    const [createOpen, setCreateOpen] = React.useState(false);
    const [form, setForm] = React.useState<CreateFormState>(EMPTY_FORM);
    const [pendingUserId, setPendingUserId] = React.useState<string | null>(
        null,
    );
    const [isCreating, startCreateTransition] = React.useTransition();

    /**
     * Submete a busca: navega para a mesma rota com `?q=` atualizado e
     * sem `cursor` (volta pra primeira página). String vazia limpa o
     * filtro.
     */
    function applySearch(value: string): void {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.delete("cursor");
        if (value.trim().length > 0) {
            params.set("q", value.trim());
        } else {
            params.delete("q");
        }
        const qs = params.toString();
        router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    }

    // Mapa rápido id → nome para a coluna de departamento.
    const departmentNameById = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const d of departments) map.set(d.id, d.name);
        return map;
    }, [departments]);

    function resetForm(): void {
        setForm(EMPTY_FORM);
    }

    async function handleRoleChange(id: string, nextRole: Role): Promise<void> {
        setPendingUserId(id);
        try {
            const result = await updateUserRoleAction(id, nextRole);
            if (result.ok) {
                setUsers((prev) =>
                    prev.map((u) => (u.id === id ? result.data : u)),
                );
                toast({
                    variant: "success",
                    title: "Papel atualizado",
                    description: `Novo papel: ${ROLE_LABELS_PT[nextRole]}.`,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível alterar o papel",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingUserId(null);
        }
    }

    async function handleDeactivate(id: string): Promise<void> {
        setPendingUserId(id);
        try {
            const result = await deactivateUserAction(id);
            if (result.ok) {
                setUsers((prev) =>
                    prev.map((u) => (u.id === id ? result.data : u)),
                );
                toast({
                    variant: "success",
                    title: "Usuário desativado",
                    description: result.data.name,
                });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível desativar o usuário",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingUserId(null);
        }
    }

    function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        const payload = {
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            role: form.role,
            departmentId:
                form.departmentId.length > 0 ? form.departmentId : undefined,
        };

        startCreateTransition(async () => {
            const result = await createUserAction(payload);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Usuário criado",
                    description: result.data.email,
                });
                setCreateOpen(false);
                resetForm();
                // Recarrega o Server Component para que a nova lista
                // (já com o usuário recém-criado) chegue. O broadcast
                // SSE também vai disparar refresh para outros admins
                // conectados.
                router.refresh();
            } else {
                // Cobre R14.3 (conflito de email): o serviço retorna
                // `CONFLICT { field: "email" }` e a mensagem fica
                // visível para o admin via toast de erro.
                toast({
                    variant: "error",
                    title: "Não foi possível criar o usuário",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    const columns: DataTableColumn<UserRow>[] = [
        {
            id: "name",
            header: "Nome",
            sortKey: "name",
            cell: (u) => (
                <div className="flex items-center gap-2.5">
                    <Avatar
                        name={u.name}
                        size="sm"
                        {...(u.avatarColor ? { color: u.avatarColor } : {})}
                        {...(u.avatarUrl ? { src: u.avatarUrl } : {})}
                    />
                    <span className="font-medium text-(--ink)">
                        {u.name}
                        {u.id === currentUserId ? (
                            <span className="ml-2 text-xs text-(--ink-3)">
                                (você)
                            </span>
                        ) : null}
                    </span>
                </div>
            ),
        },
        {
            id: "email",
            header: "E-mail",
            sortKey: "email",
            cell: (u) => <span className="text-(--ink-2)">{u.email}</span>,
        },
        {
            id: "role",
            header: "Papel",
            cell: (u) => {
                const disabled =
                    pendingUserId === u.id || u.id === currentUserId;
                return (
                    <div className="w-40">
                        <Select
                            value={u.role}
                            onValueChange={(v) =>
                                void handleRoleChange(u.id, v as Role)
                            }
                            disabled={disabled}
                        >
                            <SelectTrigger
                                aria-label={`Alterar papel de ${u.name}`}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ROLES.map((r) => (
                                    <SelectItem key={r} value={r}>
                                        {ROLE_LABELS_PT[r]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                );
            },
        },
        {
            id: "department",
            header: "Departamento",
            cell: (u) => (
                <span className="text-(--ink-2)">
                    {u.departmentId
                        ? (departmentNameById.get(u.departmentId) ?? "—")
                        : "—"}
                </span>
            ),
        },
        {
            id: "active",
            header: "Status",
            cell: (u) =>
                u.active ? (
                    <Badge tone="green">Ativo</Badge>
                ) : (
                    <Badge tone="grey">Inativo</Badge>
                ),
        },
        {
            id: "actions",
            header: "",
            width: "180px",
            cell: (u) => {
                if (u.id === currentUserId) {
                    return (
                        <span className="text-xs text-(--ink-3)">
                            conta atual
                        </span>
                    );
                }
                if (!u.active) {
                    return (
                        <span
                            className="text-xs text-(--ink-3)"
                            title="Reativação ainda não disponível"
                        >
                            desativado
                        </span>
                    );
                }
                return (
                    <Button
                        size="sm"
                        variant="default"
                        loading={pendingUserId === u.id}
                        onClick={() => void handleDeactivate(u.id)}
                    >
                        Desativar
                    </Button>
                );
            },
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <form
                    role="search"
                    onSubmit={(e) => {
                        e.preventDefault();
                        applySearch(searchInput);
                    }}
                    className="flex flex-1 items-center gap-2 sm:max-w-sm"
                >
                    <div className="relative flex-1">
                        <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--ink-3)"
                        />
                        <Input
                            type="search"
                            placeholder="Buscar por nome ou e-mail…"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-9"
                            aria-label="Buscar usuários"
                        />
                    </div>
                    {currentQuery.length > 0 ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setSearchInput("");
                                applySearch("");
                            }}
                        >
                            Limpar
                        </Button>
                    ) : null}
                </form>
                <Button
                    variant="primary"
                    icon={<Plus />}
                    onClick={() => {
                        resetForm();
                        setCreateOpen(true);
                    }}
                >
                    Novo usuário
                </Button>
            </div>

            <DataTable<UserRow>
                columns={columns}
                rows={users}
                rowKey={(u) => u.id}
            />

            {hasPrevious || nextCursor ? (
                <div className="mt-2 flex items-center justify-between">
                    {hasPrevious ? (
                        <Button variant="default" asChild>
                            <Link
                                href={
                                    currentQuery.length > 0
                                        ? `${pathname}?q=${encodeURIComponent(currentQuery)}`
                                        : pathname
                                }
                            >
                                ← Voltar ao início
                            </Link>
                        </Button>
                    ) : (
                        <span aria-hidden="true" />
                    )}
                    {nextCursor ? (
                        <Button variant="default" asChild>
                            <Link
                                href={(() => {
                                    const params = new URLSearchParams();
                                    if (currentQuery.length > 0)
                                        params.set("q", currentQuery);
                                    params.set("cursor", nextCursor);
                                    return `${pathname}?${params.toString()}`;
                                })()}
                            >
                                Próxima página →
                            </Link>
                        </Button>
                    ) : (
                        <span aria-hidden="true" />
                    )}
                </div>
            ) : null}

            <Dialog
                open={createOpen}
                onOpenChange={(next) => {
                    setCreateOpen(next);
                    if (!next) resetForm();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Novo usuário</DialogTitle>
                        <DialogDescription>
                            Crie uma conta para um colaborador. A senha
                            inicial pode ser trocada pelo próprio usuário
                            depois.
                        </DialogDescription>
                    </DialogHeader>

                    <form
                        onSubmit={handleCreateSubmit}
                        className="flex flex-col gap-4"
                    >
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="user-name"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Nome
                            </label>
                            <Input
                                id="user-name"
                                required
                                minLength={2}
                                maxLength={120}
                                value={form.name}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        name: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="user-email"
                                className="text-sm font-medium text-(--ink)"
                            >
                                E-mail
                            </label>
                            <Input
                                id="user-email"
                                type="email"
                                required
                                value={form.email}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        email: e.target.value,
                                    }))
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="user-password"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Senha temporária
                            </label>
                            <Input
                                id="user-password"
                                type="password"
                                required
                                minLength={8}
                                maxLength={128}
                                value={form.password}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        password: e.target.value,
                                    }))
                                }
                            />
                            <p className="text-xs text-(--ink-3)">
                                Mínimo 8 caracteres.
                            </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="user-role"
                                    className="text-sm font-medium text-(--ink)"
                                >
                                    Papel
                                </label>
                                <Select
                                    value={form.role}
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            role: v as Role,
                                        }))
                                    }
                                >
                                    <SelectTrigger id="user-role">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ROLES.map((r) => (
                                            <SelectItem key={r} value={r}>
                                                {ROLE_LABELS_PT[r]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="user-department"
                                    className="text-sm font-medium text-(--ink)"
                                >
                                    Departamento
                                </label>
                                <Select
                                    value={
                                        form.departmentId.length > 0
                                            ? form.departmentId
                                            : undefined
                                    }
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            departmentId: v,
                                        }))
                                    }
                                >
                                    <SelectTrigger id="user-department">
                                        <SelectValue placeholder="Selecionar…" />
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
                                Criar usuário
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
