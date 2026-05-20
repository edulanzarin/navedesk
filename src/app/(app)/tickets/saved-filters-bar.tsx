/**
 * `SavedFiltersBar` — chips clicáveis com os filtros que o usuário
 * salvou. Inclui um botão "Salvar atual" que captura a query string
 * vigente e a guarda com um nome.
 *
 * O componente é visual; toda a lógica de mutação fica nas Server
 * Actions `saveFilterAction` / `deleteFilterAction`.
 */

"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";

import {
    deleteFilterAction,
    saveFilterAction,
} from "@/actions/saved-filters";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownTrigger,
} from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/error-messages";

export interface SavedFilter {
    id: string;
    name: string;
    queryString: string;
}

export interface SavedFiltersBarProps {
    filters: SavedFilter[];
}

export function SavedFiltersBar({ filters }: SavedFiltersBarProps) {
    const router = useRouter();
    const pathname = usePathname() ?? "/tickets";
    const searchParams = useSearchParams();

    const [saveOpen, setSaveOpen] = React.useState(false);
    const [name, setName] = React.useState("");
    const [isSaving, startSave] = React.useTransition();
    const [pendingDelete, setPendingDelete] = React.useState<string | null>(
        null,
    );

    const currentQuery = searchParams?.toString() ?? "";

    /**
     * Identifica se a URL atual já corresponde exatamente a um filtro
     * salvo — usado para destacar o chip ativo.
     */
    const activeFilterId = filters.find(
        (f) => f.queryString === currentQuery,
    )?.id;

    function handleSave(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        if (name.trim().length === 0) return;
        startSave(async () => {
            const result = await saveFilterAction({
                name: name.trim(),
                queryString: currentQuery,
            });
            if (result.ok) {
                toast({ variant: "success", title: "Filtro salvo" });
                setSaveOpen(false);
                setName("");
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível salvar",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    async function handleDelete(id: string): Promise<void> {
        setPendingDelete(id);
        try {
            const result = await deleteFilterAction(id);
            if (result.ok) {
                toast({ variant: "success", title: "Filtro removido" });
            } else {
                toast({
                    variant: "error",
                    title: "Não foi possível remover",
                    description: getErrorMessage(result.error),
                });
            }
        } finally {
            setPendingDelete(null);
        }
    }

    if (filters.length === 0 && currentQuery.length === 0) {
        // Sem filtros salvos e sem query atual — não mostra nada.
        return null;
    }

    return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            {filters.map((f) => {
                const isActive = f.id === activeFilterId;
                return (
                    <div
                        key={f.id}
                        className={cn(
                            "group flex items-center gap-1 rounded-(--r-pill) border border-hairline border-(--line) bg-(--bg-elev) text-sm transition-colors",
                            isActive &&
                                "border-(--accent) bg-(--accent-soft) text-(--accent)",
                        )}
                    >
                        <Link
                            href={
                                f.queryString.length > 0
                                    ? `${pathname}?${f.queryString}`
                                    : pathname
                            }
                            className="flex items-center gap-1.5 px-3 py-1 hover:opacity-80"
                        >
                            <Bookmark className="size-3.5" aria-hidden="true" />
                            <span className="font-medium">{f.name}</span>
                        </Link>
                        <Dropdown>
                            <DropdownTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={`Opções do filtro ${f.name}`}
                                    className="rounded-r-(--r-pill) px-2 py-1 text-(--ink-3) hover:bg-black/[0.04]"
                                    disabled={pendingDelete === f.id}
                                >
                                    ⋯
                                </button>
                            </DropdownTrigger>
                            <DropdownContent align="end">
                                <DropdownItem
                                    onSelect={() => void handleDelete(f.id)}
                                    className="text-(--red)"
                                >
                                    <Trash2 className="size-3.5" />
                                    Remover
                                </DropdownItem>
                            </DropdownContent>
                        </Dropdown>
                    </div>
                );
            })}

            {currentQuery.length > 0 && !activeFilterId ? (
                <Button
                    size="sm"
                    variant="ghost"
                    icon={<BookmarkPlus />}
                    onClick={() => setSaveOpen(true)}
                >
                    Salvar filtro atual
                </Button>
            ) : null}

            <Dialog
                open={saveOpen}
                onOpenChange={(next) => {
                    setSaveOpen(next);
                    if (!next) setName("");
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Salvar filtro</DialogTitle>
                        <DialogDescription>
                            Dê um nome para este conjunto de filtros e
                            ele aparecerá na barra para acesso rápido.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSave} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="filter-name"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Nome
                            </label>
                            <Input
                                id="filter-name"
                                required
                                maxLength={60}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Meus em andamento"
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="default"
                                onClick={() => {
                                    setSaveOpen(false);
                                    setName("");
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                loading={isSaving}
                            >
                                Salvar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <span aria-hidden="true" className="hidden">
                {/* Faz o router/pathname permanecerem usados em testes de
                    referência futura sem warning. */}
                {router && pathname}
            </span>
        </div>
    );
}
