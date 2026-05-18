/**
 * Formatadores de datas e durações em português brasileiro.
 *
 * Todas as funções são puras: dado o mesmo input (e o mesmo `now` quando
 * aplicável), produzem sempre a mesma string. Datas absolutas e tempos
 * relativos delegam ao `date-fns` com o locale `pt-BR`; durações
 * (`fmtDuration`) são calculadas com aritmética simples para evitar
 * dependência de locale e manter saída determinística independentemente
 * do ambiente.
 *
 * Validates: R20.3
 */

import { format, formatDistance } from "date-fns";
import { ptBR } from "date-fns/locale/pt-BR";

/**
 * Formata uma data absoluta em pt-BR.
 *
 * Exemplo: `12 de jan de 2025`.
 */
export function fmtDate(d: Date): string {
    return format(d, "d 'de' MMM 'de' yyyy", { locale: ptBR });
}

/**
 * Formata data e hora em pt-BR.
 *
 * Exemplo: `12 de jan de 2025 às 14:30`.
 */
export function fmtDateTime(d: Date): string {
    return format(d, "d 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
}

/**
 * Tempo relativo entre `d` e `now`, com sufixo direcional ("há …" / "em …").
 *
 * O parâmetro `now` é injetável para manter a função determinística em
 * testes; quando omitido, usa `new Date()` por conveniência na UI.
 *
 * Exemplos: `há cerca de 2 horas`, `em 30 minutos`.
 */
export function relTime(d: Date, now: Date = new Date()): string {
    return formatDistance(d, now, { addSuffix: true, locale: ptBR });
}

/**
 * Formata uma duração (em milissegundos) em pt-BR usando as duas unidades
 * mais significativas. Determinística e independente de locale do sistema.
 *
 * Regras:
 * - `≥ 1 dia`: `Xd Yh` (omite `Yh` quando `Y === 0`).
 * - `≥ 1 hora`: `Xh Ymin` (omite `Ymin` quando `Y === 0`).
 * - `≥ 1 minuto`: `Xmin`.
 * - `< 1 minuto`: `Xs`.
 *
 * Valores não-positivos retornam `0s`. Frações de milissegundos são
 * truncadas para inteiros.
 */
export function fmtDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0s";

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
    }
    if (minutes > 0) {
        return `${minutes}min`;
    }
    return `${seconds}s`;
}
