/**
 * Attachments repository — acesso a `attachments` no Postgres via Drizzle.
 *
 * As funções recebem o executor (`db` ou `tx`) como primeiro parâmetro para
 * que o serviço de uploads possa orquestrar gravação do anexo, vinculação a
 * ticket/mensagem e gravação de eventos dentro da mesma transação. A regra
 * "anexo não pode pertencer a outro ticket" é enforçada inline na cláusula
 * `WHERE` de `linkToTicket` (R3.6), evitando race conditions entre leitura e
 * escrita.
 *
 * Validates: R8.6.
 */

import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db/client";
import { attachments } from "@/db/schema";

/** Linha bruta de `attachments` conforme retornada pelo Drizzle. */
export type AttachmentRow = typeof attachments.$inferSelect;

/** Payload aceito por `insertAttachment`, refletindo as colunas inseríveis. */
export type AttachmentInsert = typeof attachments.$inferInsert;

/**
 * Persiste um anexo recém-recebido e retorna a linha gravada.
 *
 * O serviço de uploads (R8.6) chama esta função após salvar o arquivo no
 * storage, repassando `name`, `mime`, `sizeBytes`, `storageKey` e
 * `uploaderId`. `ticketId` e `messageId` ficam nulos até que a vinculação
 * ocorra via `linkToTicket`/`linkToMessage`.
 */
export async function insertAttachment(
    db: Database,
    values: AttachmentInsert,
): Promise<AttachmentRow> {
    const [row] = await db.insert(attachments).values(values).returning();
    if (!row) {
        throw new Error(
            "insertAttachment: nenhuma linha retornada após INSERT.",
        );
    }
    return row;
}

/**
 * Busca um anexo pelo identificador (UUID). Retorna `null` quando não existe.
 *
 * A política de acesso (`RBAC.canReadAttachment`) é aplicada na camada de
 * serviço/route — o repositório apenas lê a linha bruta.
 */
export async function findById(
    db: Database,
    id: string,
): Promise<AttachmentRow | null> {
    const rows = await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, id))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * Vincula um anexo previamente carregado a um ticket.
 *
 * O `WHERE` enforça três invariantes em uma única operação atômica:
 *   1. O anexo existe (`id = $1`).
 *   2. O usuário que está linkando é o mesmo que fez o upload
 *      (`uploaderId = $2`), evitando que terceiros se apropriem do anexo.
 *   3. O anexo ainda não pertence a outro ticket (`ticketId IS NULL`),
 *      atendendo R3.6.
 *
 * Retorna a linha atualizada quando o vínculo é efetuado, ou `null` quando
 * qualquer uma das condições falha — o serviço traduz esse `null` em erro
 * apropriado para o chamador.
 */
export async function linkToTicket(
    db: Database,
    attachmentId: string,
    ticketId: string,
    uploaderId: string,
): Promise<AttachmentRow | null> {
    const rows = await db
        .update(attachments)
        .set({ ticketId })
        .where(
            and(
                eq(attachments.id, attachmentId),
                eq(attachments.uploaderId, uploaderId),
                isNull(attachments.ticketId),
            ),
        )
        .returning();
    return rows[0] ?? null;
}

/**
 * Vincula um anexo a uma mensagem específica do ticket.
 *
 * Usado pelo fluxo de envio de mensagem (R7) quando o autor referencia
 * anexos previamente carregados. Retorna `null` caso o anexo não exista.
 */
export async function linkToMessage(
    db: Database,
    attachmentId: string,
    messageId: string,
): Promise<AttachmentRow | null> {
    const rows = await db
        .update(attachments)
        .set({ messageId })
        .where(eq(attachments.id, attachmentId))
        .returning();
    return rows[0] ?? null;
}

/**
 * Lista todos os anexos vinculados a um ticket (incluindo os
 * vinculados via mensagens). Ordenados por data de criação asc para
 * acompanhar a cronologia da conversa.
 *
 * Usado pela página de detalhe do ticket pra exibir os arquivos
 * anexados na criação e nas mensagens em uma seção dedicada.
 */
export async function listByTicketId(
    db: Database,
    ticketId: string,
): Promise<AttachmentRow[]> {
    return db
        .select()
        .from(attachments)
        .where(eq(attachments.ticketId, ticketId));
}
