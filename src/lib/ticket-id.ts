/**
 * Geração de identificadores de ticket no formato `NVD-{n}`.
 *
 * O número `n` vem da sequência Postgres `ticket_seq` (criada pela migration
 * manual `src/db/sql/0001_ticket_seq.sql`, que parte de 1042 e incrementa de
 * 1 em 1). A atomicidade do `nextval` no Postgres garante que chamadas
 * concorrentes recebam inteiros distintos sem colisões e que chamadas
 * sequenciais produzam valores estritamente crescentes — propriedades
 * validadas pelos testes 7 e 8 da fase 8.
 *
 * O prefixo é parametrizável (`NVD` para tickets do produto) mas restrito a
 * 2..4 letras maiúsculas para preservar o formato `^[A-Z]{2,4}-[0-9]+$`
 * exigido pelo design e pelo regex usado em integrações externas.
 *
 * Validates: R9.1, R9.2, R9.5.
 */

import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

/**
 * Regex que define um prefixo válido para identificadores de ticket.
 * Imutável, exportada para que testes e schemas Zod possam reusá-la sem
 * duplicar a regra.
 */
export const TICKET_PREFIX_REGEX: RegExp = /^[A-Z]{2,4}$/;

/**
 * Erro lançado quando `nextTicketId` recebe um prefixo que não satisfaz
 * `TICKET_PREFIX_REGEX`. Carrega o valor recebido para mensagens precisas.
 */
export class InvalidTicketPrefixError extends Error {
    constructor(public readonly prefix: string) {
        super(
            `Prefixo de ticket inválido: ${JSON.stringify(prefix)}. ` +
            `Esperado /^[A-Z]{2,4}$/.`,
        );
        this.name = "InvalidTicketPrefixError";
    }
}

/**
 * Erro lançado quando a sequência `ticket_seq` não retorna um valor
 * utilizável. Indica configuração ausente (sequência não criada) ou
 * resultado inesperado do driver.
 */
export class TicketSequenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TicketSequenceError";
    }
}

/**
 * Linha retornada por `SELECT nextval('ticket_seq')`. O driver `pg`
 * representa `bigint` como `string` por padrão, mas aceitamos `number`
 * e `bigint` para robustez caso a configuração do parser mude no futuro.
 */
type NextvalRow = { nextval: string | number | bigint };

/**
 * Produz o próximo identificador de ticket para o prefixo informado.
 *
 * Pré-condições:
 * - `prefix` casa com `TICKET_PREFIX_REGEX` (2..4 letras maiúsculas).
 * - `db` está conectado a um Postgres onde a sequência `ticket_seq` existe.
 *
 * Pós-condições:
 * - Retorna `${prefix}-${n}` onde `n` é o próximo valor de `ticket_seq`.
 * - `n` é um inteiro estritamente crescente entre chamadas sequenciais com
 *   o mesmo `db` (R9.4) e distinto entre chamadas concorrentes (R9.3).
 *
 * Lança:
 * - `InvalidTicketPrefixError` se `prefix` não casa com a regex.
 * - `TicketSequenceError` se a sequência não retorna um valor numérico
 *   válido (positivo e finito).
 *
 * Observação: a função delega ao Postgres a geração do número via `nextval`
 * para preservar a atomicidade da sequência. Não realiza nenhuma escrita
 * adicional — quem persiste o ticket é o serviço de domínio, que invoca
 * esta função dentro da transação de criação.
 */
export async function nextTicketId(
    prefix: string,
    db: Database,
): Promise<string> {
    if (!TICKET_PREFIX_REGEX.test(prefix)) {
        throw new InvalidTicketPrefixError(prefix);
    }

    const result = await db.execute<NextvalRow>(
        sql`SELECT nextval('ticket_seq') AS nextval`,
    );

    const row = result.rows[0];
    if (!row) {
        throw new TicketSequenceError(
            "Sequência ticket_seq não retornou nenhuma linha; " +
            "verifique se a migration 0001_ticket_seq.sql foi aplicada.",
        );
    }

    const n = parseSequenceValue(row.nextval);
    return `${prefix}-${n}`;
}

/**
 * Normaliza o valor cru devolvido pelo driver para um inteiro positivo
 * representado como string (a forma final usada no identificador). Aceita
 * `string` (caso padrão do `pg` para `bigint`), `number` e `bigint`.
 *
 * Rejeita valores não-finitos, não-inteiros, não-positivos ou strings que
 * não representam um inteiro decimal — qualquer um deles indica corrupção
 * de driver ou alteração não intencional na configuração da sequência.
 */
function parseSequenceValue(value: string | number | bigint): string {
    if (typeof value === "bigint") {
        if (value <= 0n) {
            throw new TicketSequenceError(
                `Valor inválido em ticket_seq: ${value} (esperado inteiro positivo).`,
            );
        }
        return value.toString();
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
            throw new TicketSequenceError(
                `Valor inválido em ticket_seq: ${value} (esperado inteiro positivo).`,
            );
        }
        return value.toString();
    }

    // typeof value === "string"
    if (!/^[1-9][0-9]*$/.test(value)) {
        throw new TicketSequenceError(
            `Valor inválido em ticket_seq: ${JSON.stringify(value)} ` +
            "(esperado representação decimal de inteiro positivo).",
        );
    }
    return value;
}
