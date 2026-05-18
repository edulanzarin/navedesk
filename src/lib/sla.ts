/**
 * Cálculo puro de SLA para tickets.
 *
 * Este módulo concentra as duas funções deterministas que o domínio precisa
 * para raciocinar sobre prazos:
 *
 * - `computeSlaDeadline`: calcula o `Date` em que o SLA vence, usado na criação
 *   do ticket para fixar `slaDeadline` segundo a política vigente.
 * - `computeSlaInfo`: deriva, em um instante específico, o tempo restante,
 *   o percentual decorrido e o nível de alerta exibido na UI.
 *
 * Ambas são puras: nunca leem `Date.now()`, não acessam I/O, e dado o mesmo
 * input retornam sempre o mesmo output. Isso permite testá-las com PBT e
 * reusá-las tanto no servidor (`services/`) quanto no cliente
 * (`SlaMeter`) sem efeitos colaterais.
 *
 * A unidade da política é **minutos** (campo `SlaPolicy.minutes`). Minutos
 * permitem prazos sub-hora (ex.: 30 minutos para prioridade `critica`).
 *
 * Validates: R6.2, R6.3, R6.4, R6.5, R6.6, R6.7, R6.9.
 */

import type { Priority, SlaInfo, SlaPolicy } from "@/types/domain";

/** Milissegundos em um minuto — fator de conversão `minutes → ms`. */
const MS_PER_MINUTE = 60_000;

/** Limiar relativo (fração de `totalMs`) abaixo do qual o nível vira `crit`. */
const CRIT_THRESHOLD = 0.1;

/** Limiar relativo (fração de `totalMs`) abaixo do qual o nível vira `warn`. */
const WARN_THRESHOLD = 0.25;

/**
 * Calcula o prazo de SLA a partir de `now`, da prioridade e das políticas
 * vigentes.
 *
 * O resultado satisfaz `result.getTime() === now.getTime() +
 * policy.minutes * 60_000`, onde `policy` é a entrada de `policies` cuja
 * `priority` casa com o argumento. A função é total no domínio válido e
 * lança um erro descritivo quando não há política para a prioridade —
 * situação que indica configuração incompleta de banco e deve ser tratada
 * na borda.
 *
 * Pré-condições (responsabilidade do chamador):
 * - `now` é um `Date` válido.
 * - `policies` contém exatamente uma entrada por prioridade, com
 *   `minutes > 0`.
 *
 * @throws {Error} se nenhuma política for encontrada para `priority`.
 */
export function computeSlaDeadline(
    now: Date,
    priority: Priority,
    policies: SlaPolicy[],
): Date {
    const policy = findPolicy(priority, policies);
    return new Date(now.getTime() + policy.minutes * MS_PER_MINUTE);
}

/**
 * Deriva o estado atual do SLA de um ticket a partir do `deadline` previamente
 * calculado e do instante `now`.
 *
 * Campos do retorno:
 * - `remainingMs`: `deadline.getTime() - now.getTime()`. Negativo quando o
 *   prazo já venceu.
 * - `pctElapsed`: percentual decorrido em relação a `totalMs =
 *   policy.minutes * 60_000`, fixado em `[0, 100]` para que `now` antes
 *   da criação ou muito após o vencimento não rompa a UI.
 * - `level`: nível de alerta segundo os limiares do design:
 *   - `remainingMs ≤ 0` → `"breached"` (estado absorvente, R6.7).
 *   - `remainingMs ≤ totalMs * 0.10` → `"crit"`.
 *   - `remainingMs ≤ totalMs * 0.25` → `"warn"`.
 *   - caso contrário → `"ok"`.
 *
 * A ordem de avaliação é importante: `breached` tem precedência sobre `crit`
 * e `warn` mesmo quando o tempo restante é exatamente `0`.
 *
 * @throws {Error} se nenhuma política for encontrada para `priority`.
 */
export function computeSlaInfo(
    deadline: Date,
    priority: Priority,
    policies: SlaPolicy[],
    now: Date,
): SlaInfo {
    const policy = findPolicy(priority, policies);
    const totalMs = policy.minutes * MS_PER_MINUTE;
    const remainingMs = deadline.getTime() - now.getTime();
    const pctElapsed = clamp(100 - (remainingMs / totalMs) * 100, 0, 100);

    const level: SlaInfo["level"] =
        remainingMs <= 0
            ? "breached"
            : remainingMs <= totalMs * CRIT_THRESHOLD
                ? "crit"
                : remainingMs <= totalMs * WARN_THRESHOLD
                    ? "warn"
                    : "ok";

    return { level, remainingMs, pctElapsed };
}

/**
 * Localiza a política de SLA para uma prioridade. Encapsulada em função
 * privada para que ambas as funções públicas tenham comportamento idêntico
 * em caso de configuração ausente.
 */
function findPolicy(priority: Priority, policies: SlaPolicy[]): SlaPolicy {
    const policy = policies.find((p) => p.priority === priority);
    if (!policy) {
        throw new Error(
            `Nenhuma política de SLA encontrada para a prioridade "${priority}".`,
        );
    }
    return policy;
}

/** Restringe `n` ao intervalo fechado `[min, max]`. */
function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}
