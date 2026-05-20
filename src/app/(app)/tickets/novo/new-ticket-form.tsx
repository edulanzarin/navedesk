/**
 * `NewTicketForm` — Client Component que adapta o `TicketForm` (puro,
 * "burro") à Server Action `createTicketAction`, cuida do redirect
 * pós-sucesso (R3.7) e expõe o seletor de templates para
 * pré-preenchimento dos campos.
 *
 * Templates são apenas atalhos: ao escolher um, os campos do form
 * são preenchidos via `initialValues` e o usuário pode editar livremente
 * antes de submeter.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { FileText, UserPlus } from "lucide-react";

import {
    TicketForm,
    type TicketFormProps,
    type TicketFormValues,
} from "@/components/domain/ticket-form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { createTicketAction } from "@/actions/tickets";
import { getErrorMessage } from "@/lib/error-messages";
import type { Priority } from "@/types/domain";

export interface TicketTemplate {
    id: string;
    name: string;
    title: string;
    description: string;
    priority: Priority;
    categoryId: string;
    departmentId: string | null;
}

/**
 * Solicitante candidato exibido no select "Em nome de" (admin/tecnico).
 * `email` aparece em texto secundário para distinguir homônimos.
 */
export interface RequesterOption {
    id: string;
    name: string;
    email: string;
}

export type NewTicketFormProps = Pick<
    TicketFormProps,
    "categories" | "departments"
> & {
    templates: TicketTemplate[];
    /**
     * Lista de possíveis solicitantes. Quando `undefined`, o seletor
     * "Em nome de" não é exibido (ator é solicitante comum, R3 padrão).
     */
    requesters?: RequesterOption[];
};

export function NewTicketForm({
    categories,
    departments,
    templates,
    requesters,
}: NewTicketFormProps): React.ReactElement {
    const router = useRouter();
    const [selectedTemplateId, setSelectedTemplateId] = React.useState<
        string | undefined
    >(undefined);
    const [requesterId, setRequesterId] = React.useState<string | undefined>(
        undefined,
    );

    const showRequesterPicker = !!requesters && requesters.length > 0;

    /**
     * `initialValues` reage à seleção de template. A referência muda
     * a cada escolha (mesmo voltando para um já selecionado antes),
     * disparando o `reset` interno do `TicketForm`.
     */
    const initialValues = React.useMemo<
        Partial<TicketFormValues> | undefined
    >(() => {
        if (!selectedTemplateId) return undefined;
        const tpl = templates.find((t) => t.id === selectedTemplateId);
        if (!tpl) return undefined;
        return {
            title: tpl.title,
            description: tpl.description,
            priority: tpl.priority,
            categoryId: tpl.categoryId,
            departmentId: tpl.departmentId ?? "",
        };
    }, [selectedTemplateId, templates]);

    async function handleSubmit(
        values: TicketFormValues,
    ): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
        const { assigneeId: _assigneeId, ...payload } = values;
        void _assigneeId;

        // Quando o ator é admin/tecnico e selecionou alguém em "Em
        // nome de", manda o `requesterId` no payload para o serviço
        // gravar o ticket em nome do solicitante real.
        const finalPayload = requesterId
            ? { ...payload, requesterId }
            : payload;

        const result = await createTicketAction(finalPayload);
        if (result.ok) {
            toast({
                variant: "success",
                title: "Chamado aberto",
                description: `Ticket ${result.data.id} criado com sucesso.`,
            });
            router.push(`/tickets/${result.data.id}`);
            return { ok: true, id: result.data.id };
        }
        return { ok: false, message: getErrorMessage(result.error) };
    }

    return (
        <div className="flex flex-col gap-5">
            {showRequesterPicker ? (
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="requester-select"
                        className="flex items-center gap-1.5 text-sm font-medium text-(--ink)"
                    >
                        <UserPlus className="size-4" aria-hidden="true" />
                        Em nome de (opcional)
                    </label>
                    <Select
                        value={requesterId}
                        onValueChange={(v) =>
                            setRequesterId(v.length > 0 ? v : undefined)
                        }
                    >
                        <SelectTrigger id="requester-select">
                            <SelectValue placeholder="Eu mesmo (padrão)" />
                        </SelectTrigger>
                        <SelectContent>
                            {requesters!.map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                    {r.name} — {r.email}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-(--ink-3)">
                        Selecione o solicitante quando estiver abrindo o
                        chamado em nome de outra pessoa. Em branco abre
                        em seu próprio nome.
                    </p>
                </div>
            ) : null}

            {templates.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="template-select"
                        className="flex items-center gap-1.5 text-sm font-medium text-(--ink)"
                    >
                        <FileText className="size-4" aria-hidden="true" />
                        Usar um modelo (opcional)
                    </label>
                    <Select
                        value={selectedTemplateId}
                        onValueChange={(v) => setSelectedTemplateId(v)}
                    >
                        <SelectTrigger id="template-select">
                            <SelectValue placeholder="Selecionar modelo…" />
                        </SelectTrigger>
                        <SelectContent>
                            {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-(--ink-3)">
                        Os campos serão preenchidos com os valores do
                        modelo. Você pode editar antes de enviar.
                    </p>
                </div>
            ) : null}

            <TicketForm
                categories={categories}
                departments={departments}
                onSubmit={handleSubmit}
                initialValues={initialValues}
            />
        </div>
    );
}
