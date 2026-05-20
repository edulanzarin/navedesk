/**
 * Logger estruturado central do NaveDesk.
 *
 * Implementação leve sem dependências externas — emite JSON em
 * produção (uma linha por evento, parseável por Loki/Datadog/ELK) e
 * formato amigável pra leitura humana em dev.
 *
 * Por que não Pino direto?
 * - Pino é excelente mas exige bump no `pnpm-lock.yaml`. Como o caso
 *   de uso atual cabe em ~80 linhas, optamos por uma implementação
 *   própria com a mesma API (`logger.info(ctx, msg)`).
 * - Se um dia o volume crescer ou precisarmos de plugins, basta
 *   trocar o módulo por Pino real — a API é compatível.
 *
 * Uso:
 *   import { logger } from "@/lib/logger";
 *   logger.info({ ticketId: "NVD-1042", actorId: user.id }, "ticket created");
 *   logger.error({ err }, "failed to publish event");
 *
 * Convenções:
 * - Mensagens em inglês curtas (padrão técnico — facilita grep).
 * - Sempre passar contexto como primeiro argumento (objeto). Vai pra
 *   raiz da linha JSON e fica filtrável.
 * - Erros vão na chave `err` — serializamos `name`/`message`/`stack`.
 *
 * Singleton via `globalThis` pra sobreviver ao Hot Module Reload do
 * Next.js (sem isso, cada save em dev recria configuração).
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<Level, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

interface LoggerOptions {
    level: Level;
    pretty: boolean;
}

interface SerializedError {
    name: string;
    message: string;
    stack?: string;
    code?: unknown;
    cause?: SerializedError;
}

/**
 * Serializa erro recursivamente, preservando `cause` quando presente.
 * Limita profundidade pra evitar loop em causes circulares.
 */
function serializeError(err: unknown, depth = 0): SerializedError | unknown {
    if (depth > 5) return "[truncated]";
    if (!(err instanceof Error)) return err;

    const out: SerializedError = {
        name: err.name,
        message: err.message,
    };
    if (err.stack) out.stack = err.stack;
    const code = (err as Error & { code?: unknown }).code;
    if (code !== undefined) out.code = code;
    if (err.cause) {
        out.cause = serializeError(err.cause, depth + 1) as SerializedError;
    }
    return out;
}

const REDACTED_KEYS = new Set([
    "passwordHash",
    "password",
    "AUTH_SECRET",
    "authorization",
    "cookie",
]);

/**
 * Substitui valores de chaves sensíveis por `[REDACTED]`. Recursivo
 * com proteção contra ciclos (limita profundidade a 5).
 */
function redact(value: unknown, depth = 0): unknown {
    if (depth > 5) return "[truncated]";
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        return value.map((v) => redact(v, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (REDACTED_KEYS.has(k)) {
            out[k] = "[REDACTED]";
        } else {
            out[k] = redact(v, depth + 1);
        }
    }
    return out;
}

/**
 * Formata uma linha humana-legível pra dev. Cor mínima (sem
 * dependência) usando códigos ANSI.
 */
function formatPretty(level: Level, msg: string, ctx: object): string {
    const colors: Record<Level, string> = {
        debug: "\x1b[90m", // gray
        info: "\x1b[36m", // cyan
        warn: "\x1b[33m", // yellow
        error: "\x1b[31m", // red
    };
    const reset = "\x1b[0m";
    const time = new Date().toISOString().slice(11, 19);
    const prefix = `${colors[level]}${level.toUpperCase().padEnd(5)}${reset} ${time}`;
    const ctxKeys = Object.keys(ctx);
    if (ctxKeys.length === 0) return `${prefix} ${msg}`;
    return `${prefix} ${msg} ${JSON.stringify(redact(ctx))}`;
}

class StructuredLogger {
    constructor(private readonly options: LoggerOptions) {}

    private log(level: Level, ctxOrMsg: object | string, maybeMsg?: string): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.options.level]) return;

        let ctx: Record<string, unknown> = {};
        let msg: string;
        if (typeof ctxOrMsg === "string") {
            msg = ctxOrMsg;
        } else {
            ctx = { ...ctxOrMsg };
            // Serializa `err` se presente.
            if ("err" in ctx) {
                ctx.err = serializeError(ctx.err);
            }
            msg = maybeMsg ?? "";
        }

        if (this.options.pretty) {
            const line = formatPretty(level, msg, ctx);
            // eslint-disable-next-line no-console
            (level === "error" ? console.error : console.log)(line);
            return;
        }

        // JSON estruturado pra produção.
        const redactedCtx = redact(ctx);
        const ctxObject =
            redactedCtx && typeof redactedCtx === "object" && !Array.isArray(redactedCtx)
                ? (redactedCtx as Record<string, unknown>)
                : {};
        const record = {
            time: new Date().toISOString(),
            level,
            service: "navedesk",
            env: process.env.NODE_ENV ?? "development",
            msg,
            ...ctxObject,
        };
        // eslint-disable-next-line no-console
        (level === "error" ? console.error : console.log)(
            JSON.stringify(record),
        );
    }

    debug(ctxOrMsg: object | string, msg?: string): void {
        this.log("debug", ctxOrMsg, msg);
    }
    info(ctxOrMsg: object | string, msg?: string): void {
        this.log("info", ctxOrMsg, msg);
    }
    warn(ctxOrMsg: object | string, msg?: string): void {
        this.log("warn", ctxOrMsg, msg);
    }
    error(ctxOrMsg: object | string, msg?: string): void {
        this.log("error", ctxOrMsg, msg);
    }
}

const GLOBAL_KEY = Symbol.for("navedesk:logger");

type GlobalWithLogger = typeof globalThis & {
    [GLOBAL_KEY]?: StructuredLogger;
};

function buildLogger(): StructuredLogger {
    const isProd = process.env.NODE_ENV === "production";
    const envLevel = process.env.LOG_LEVEL as Level | undefined;
    const level: Level =
        envLevel && envLevel in LEVEL_PRIORITY
            ? envLevel
            : isProd
                ? "info"
                : "debug";
    return new StructuredLogger({ level, pretty: !isProd });
}

export const logger: StructuredLogger = (() => {
    const g = globalThis as GlobalWithLogger;
    if (!g[GLOBAL_KEY]) {
        g[GLOBAL_KEY] = buildLogger();
    }
    return g[GLOBAL_KEY]!;
})();

/**
 * Captura e loga uma exceção sem propagar. Use em fluxos onde a
 * operação principal já completou e a falha é apenas em algo
 * secundário (ex.: publicar evento realtime depois de COMMIT).
 *
 * ```ts
 * try { await publishEvent(...) } catch (err) { swallow("publishEvent failed", err) }
 * ```
 */
export function swallow(message: string, err: unknown, ctx?: object): void {
    logger.error({ err, ...(ctx ?? {}) }, message);
}
