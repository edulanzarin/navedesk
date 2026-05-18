/**
 * Cache em memória com TTL para leituras estáveis (R15.3).
 *
 * Esta implementação simples é suficiente para um único processo Next.js
 * (modo standalone do Docker). O design (`Considerações de Performance →
 * Cache de leituras estáveis`) prevê 60 segundos de TTL para categorias,
 * departamentos e políticas de SLA, que praticamente só mudam por ações
 * administrativas. A invalidação manual via `invalidate(key)` é chamada
 * pelas Server Actions de admin para refletir mudanças imediatamente —
 * ver `services/admin.service.ts` (R15.3, R6.10).
 *
 * Características:
 *
 * - Tipagem genérica em `get<T>` / `set<T>`: o caller é responsável pelo
 *   contrato; a entrada armazenada é `unknown` para impedir um único cache
 *   global de "vazar" tipos entre chaves.
 * - Expiração lazy: a entrada é removida no primeiro `get` após o TTL,
 *   evitando timers e o risco de leaks em testes/dev.
 * - Sem dependências externas. Em produção multi-instância, a substituição
 *   por Redis/`unstable_cache` é local — basta trocar o `stableReadsCache`.
 *
 * Validates: R15.3.
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export interface TtlCache {
    /**
     * Recupera o valor armazenado em `key` se ainda não expirou.
     * Retorna `undefined` para chave inexistente ou expirada (e remove a
     * entrada expirada do mapa interno).
     */
    get<T>(key: string): T | undefined;
    /**
     * Armazena `value` sob `key` com o TTL informado em milissegundos.
     * Quando `ttlMs` não é fornecido, usa o TTL default da instância.
     */
    set<T>(key: string, value: T, ttlMs?: number): void;
    /** Remove a entrada associada a `key`, se existir. */
    invalidate(key: string): void;
    /** Limpa todas as entradas. Útil em testes e em troca de tenant. */
    clear(): void;
}

/**
 * Constrói uma instância isolada de cache TTL.
 *
 * Cada chamada produz um `Map` próprio, o que torna fácil isolar caches
 * por subsistema (por exemplo, um cache para taxonomia e outro para
 * configuração) e simplifica os testes — basta criar uma instância nova.
 *
 * @param defaultTtlMs TTL aplicado quando `set` é chamado sem `ttlMs`.
 */
export function createTtlCache(defaultTtlMs = 60_000): TtlCache {
    const store = new Map<string, CacheEntry<unknown>>();
    return {
        get<T>(key: string): T | undefined {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt < Date.now()) {
                store.delete(key);
                return undefined;
            }
            return entry.value as T;
        },
        set<T>(key: string, value: T, ttlMs = defaultTtlMs): void {
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
        },
        invalidate(key: string): void {
            store.delete(key);
        },
        clear(): void {
            store.clear();
        },
    };
}

/**
 * Cache global de leituras estáveis com TTL de 60 segundos.
 *
 * Compartilhado por `services/reads.service.ts` para `getAllSlaPolicies`,
 * `listCategories` e `listDepartments`. As Server Actions de admin
 * (R15.3, R6.10) invalidam manualmente as chaves apropriadas após cada
 * mutação para que a próxima leitura reflita o estado atualizado sem
 * esperar a expiração natural.
 */
export const stableReadsCache = createTtlCache(60_000);
