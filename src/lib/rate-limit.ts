/**
 * Rate limiter de uso geral para mitigar brute force e abuso.
 *
 * Por enquanto a implementação é puramente em memória (`Map<string, Entry>`),
 * adequada para desenvolvimento e para um único processo Node em produção
 * leve. A interface `RateLimiter` foi pensada como um *hook* para troca por
 * `@upstash/ratelimit` (ou outra solução distribuída) sem precisar tocar nos
 * call sites: basta exportar uma instância que satisfaça o mesmo contrato.
 *
 * O contador é uma janela fixa simples — `count` reinicia quando o usuário
 * volta após `windowMs`. Para o caso de uso atual (10 logins/min/IP), isso é
 * suficiente; em uma evolução futura podemos trocar por sliding window.
 *
 * Validates: R1.9.
 */

interface RateLimitEntry {
    count: number;
    expiresAt: number;
}

export interface RateLimitResult {
    /** `true` se a requisição deve ser permitida. */
    allowed: boolean;
    /** Quantas requisições ainda restam dentro da janela atual. */
    remaining: number;
    /** Epoch (ms) em que a janela atual expira e o contador reinicia. */
    resetAt: number;
}

export interface RateLimitOptions {
    /** Número máximo de requisições permitidas por janela. */
    limit: number;
    /** Tamanho da janela em milissegundos. */
    windowMs: number;
}

export interface RateLimiter {
    check(key: string, opts: RateLimitOptions): RateLimitResult;
}

/**
 * Implementação em memória, processo-local.
 *
 * Janela fixa: a cada chave guardamos `{ count, expiresAt }`. Um leitor que
 * chega depois de `expiresAt` reseta o contador (expire-on-read). Para evitar
 * que chaves "abandonadas" — IPs que tentaram uma vez e nunca mais voltaram —
 * permaneçam indefinidamente no `Map`, agendamos uma varredura periódica que
 * remove entradas vencidas. O timer usa `unref()` para não impedir o desligamento
 * do processo Node.
 */
export class InMemoryRateLimiter implements RateLimiter {
    private readonly store = new Map<string, RateLimitEntry>();

    private sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly options: { sweepIntervalMs?: number } = {},
    ) {
        const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
        // Em ambientes Edge/Workers `setInterval` pode não estar disponível;
        // protegemos contra isso para que o módulo permaneça importável.
        if (typeof setInterval === "function") {
            this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
            // `unref` existe no Node mas não em todos os runtimes; ignore se ausente.
            const timer = this.sweepTimer as { unref?: () => void };
            timer.unref?.();
        }
    }

    check(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
        const now = Date.now();
        const entry = this.store.get(key);

        if (!entry || entry.expiresAt <= now) {
            const expiresAt = now + windowMs;
            this.store.set(key, { count: 1, expiresAt });
            return {
                allowed: true,
                remaining: Math.max(0, limit - 1),
                resetAt: expiresAt,
            };
        }

        entry.count += 1;
        return {
            allowed: entry.count <= limit,
            remaining: Math.max(0, limit - entry.count),
            resetAt: entry.expiresAt,
        };
    }

    /**
     * Remove entradas expiradas. Chamada periodicamente pelo timer interno;
     * exposto para que testes possam dispará-la manualmente.
     */
    sweep(now: number = Date.now()): void {
        for (const [key, entry] of this.store) {
            if (entry.expiresAt <= now) {
                this.store.delete(key);
            }
        }
    }

    /**
     * Para o timer e libera as entradas. Útil em testes para evitar
     * handles pendentes ao final da suíte.
     */
    dispose(): void {
        if (this.sweepTimer !== null) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
        this.store.clear();
    }

    /** Acesso somente para testes — verifica quantas chaves estão guardadas. */
    get size(): number {
        return this.store.size;
    }
}

/**
 * Limite oficial do `/login`: dez tentativas por minuto, por IP. Exposto como
 * constante para reuso entre o middleware/route handler e os testes de integração.
 */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
    limit: 10,
    windowMs: 60_000,
} as const;

/**
 * Instância única usada pela rota de login. Trocar por uma implementação
 * baseada em `@upstash/ratelimit` exige apenas exportar outro objeto que
 * satisfaça `RateLimiter` aqui.
 */
export const loginRateLimiter: RateLimiter = new InMemoryRateLimiter();

/**
 * Limite oficial do `/api/uploads`: trinta uploads por minuto, por usuário
 * autenticado. Aplicado pelo route handler de upload (task 18.2), que usa
 * `user.id` da sessão como chave.
 *
 * Validates: R8.9.
 */
export const UPLOAD_RATE_LIMIT: RateLimitOptions = {
    limit: 30,
    windowMs: 60_000,
} as const;

/**
 * Instância única usada pela rota de upload. Assim como `loginRateLimiter`,
 * pode ser substituída por uma implementação distribuída sem alterar os
 * call sites — basta exportar outro objeto que satisfaça `RateLimiter`.
 */
export const uploadRateLimiter: RateLimiter = new InMemoryRateLimiter();
