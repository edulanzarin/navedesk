/**
 * `NewTicketForm` — Client Component que adapta o `TicketForm` (puro,
 * "burro") à Server Action `createTicketAction` e cuida do redirect
 * após sucesso (R3.7).
 *
 * Por que existir?
 *
 * - O contrato de `TicketForm.onSubmit` é um callback assíncrono que
 *   devolve `{ ok: true; id } | { ok: false; message }`. A Server
 *   Action `createTicketAction` devolve `ActionResult<Ticket>`. Esta
 *   camada faz a tradução fina entre os dois shapes — em vez de poluir
 *   o componente de domínio com conhecimento da action, e em vez de
 *   tornar a página inteira `"use client"` só para acessar
 *   `useRouter`.
 * - Mantém a página `/tickets/novo` como Server Component puro,
 *   responsável apenas por carregar dados e aplicar a defesa em
 *   profundidade da sessão.
 *
 * Comportamento:
 *
 * 1. O `TicketForm` faz o upload incremental dos anexos para
 *    `/api/uploads` e entrega ao `onSubmit` os IDs já validados,
 *    junto com `title`, `description`, `categoryId`, `departmentId`,
 *    `priority` e (opcional) `assigneeId`.
 * 2. Aqui descartamos `assigneeId` antes de enviar à action — o
 *    `CreateTicketSchema` e o `tickets.service.createTicket` ainda não
 *    consomem pré-atribuição na criação. Quando essa funcionalidade
 *    chegar, basta encadear `assignTicketAction` em sucesso (R3.8).
 * 3. Em sucesso (`ActionResult.ok === true`): toast positivo e
 *    `router.push("/tickets/{id}")` (R3.7).
 * 4. Em erro: devolvemos `{ ok: false, message }` para o `TicketForm`
 *    exibir o toast de erro e manter os campos preenchidos para
 *    correção. Quando o erro vem do RBAC do servidor (`FORBIDDEN`),
 *    a UI ainda mostra o controle por simplicidade — a action é a
 *    fonte da verdade.
 *
 * Validates: R3.7.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import {
    TicketForm,
    type TicketFormProps,
    type TicketFormValues,
} from "@/components/domain/ticket-form";
import { toast } from "@/components/ui/use-toast";
import { createTicketAction } from "@/actions/tickets";
import { getErrorMessage } from "@/lib/error-messages";

/**
 * Props expostas — espelha as do `TicketForm`, exceto `onSubmit` (que é
 * preenchido aqui) e os campos relacionados a pré-atribuição (mantidos
 * desligados nesta task; podem ser habilitados no futuro sem mudar o
 * contrato da página).
 */
export type NewTicketFormProps = Pick<
    TicketFormProps,
    "categories" | "departments"
>;

export function NewTicketForm({
    categories,
    departments,
}: NewTicketFormProps): React.ReactElement {
    const router = useRouter();

    async function handleSubmit(
        values: TicketFormValues,
    ): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
        // `assigneeId` ainda não é consumido pelo `CreateTicketSchema`;
        // remover antes de chamar a action evita disparar erro de
        // validação caso alguém habilite `allowAssign` por engano.
        const { assigneeId: _assigneeId, ...payload } = values;
        void _assigneeId;

        const result = await createTicketAction(payload);
        if (result.ok) {
            toast({
                variant: "success",
                title: "Chamado aberto",
                description: `Ticket ${result.data.id} criado com sucesso.`,
            });
            // Redireciona para o detalhe do ticket recém-criado (R3.7).
            // `router.push` mantém a navegação no client, evitando full
            // reload — combina com a `revalidatePath("/tickets")` já
            // disparada pela action.
            router.push(`/tickets/${result.data.id}`);
            return { ok: true, id: result.data.id };
        }

        return { ok: false, message: getErrorMessage(result.error) };
    }

    return (
        <TicketForm
            categories={categories}
            departments={departments}
            onSubmit={handleSubmit}
        />
    );
}
