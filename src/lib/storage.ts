/**
 * Abstração de armazenamento de arquivos para anexos.
 *
 * O MVP roda local (volume Docker) com {@link LocalDiskStorage}, mas o
 * resto da aplicação consome apenas a interface {@link StorageService}.
 * Trocar para S3/MinIO no futuro é uma reimplementação isolada — nenhum
 * serviço/route handler precisa mudar.
 *
 * Layout local: `{rootDir}/{yyyy}/{mm}/{uuid}.{ext}` em UTC, conforme R8.5.
 * Usar UTC evita ambiguidade ao redor da meia-noite e preserva o
 * particionamento mesmo se o servidor mudar de fuso.
 *
 * Segurança: todas as operações que recebem `key` validam que o caminho
 * resolvido permanece dentro de `rootDir`. Isso bloqueia path traversal
 * (`../../etc/passwd`) e caminhos absolutos antes que cheguem ao FS.
 *
 * Validates: R8.5.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Resultado de uma operação `put` bem-sucedida. `key` é a chave relativa
 * (com separadores `/`) que deve ser persistida em `attachments.storage_key`;
 * `sizeBytes` é o tamanho real do conteúdo gravado.
 */
export interface PutResult {
    key: string;
    sizeBytes: number;
}

/**
 * Opções para {@link StorageService.put}.
 *
 * - `ext`: extensão do arquivo (com ou sem ponto). Caracteres não
 *   alfanuméricos são removidos antes de compor o nome final, evitando
 *   que metadados maliciosos influenciem o caminho.
 * - `now`: relógio injetável para tornar o particionamento yyyy/mm
 *   determinístico em testes. Usa `new Date()` quando omitido.
 */
export interface PutOptions {
    ext: string;
    now?: Date;
}

/**
 * Contrato da camada de armazenamento. Implementações devem garantir que:
 *
 * - `put` produz uma chave única por chamada (mesmo com `now` fixo).
 * - `get`/`delete` rejeitam chaves que escapem do diretório raiz.
 * - `delete` é idempotente: ausência do arquivo não é erro.
 * - `resolvePath` retorna o caminho absoluto correspondente à chave,
 *   também validado contra path traversal.
 */
export interface StorageService {
    /** Grava `buffer` sob uma chave gerada e retorna `{ key, sizeBytes }`. */
    put(buffer: Buffer, opts: PutOptions): Promise<PutResult>;
    /** Lê os bytes da chave informada. Lança se o arquivo não existir. */
    get(key: string): Promise<Buffer>;
    /** Remove o arquivo. Não falha se a chave não existir. */
    delete(key: string): Promise<void>;
    /** Resolve o caminho absoluto correspondente à chave. */
    resolvePath(key: string): string;
}

/**
 * Erro lançado quando uma chave tenta sair do `rootDir` (path traversal,
 * caminho absoluto, ou referências esquisitas como `..\\`). A mensagem
 * inclui a chave recebida para facilitar diagnóstico em logs sem expor
 * o caminho absoluto resolvido.
 */
export class InvalidStorageKeyError extends Error {
    constructor(public readonly key: string) {
        super(
            `Chave de armazenamento inválida: ${JSON.stringify(key)}. ` +
            "A chave deve permanecer dentro do diretório raiz.",
        );
        this.name = "InvalidStorageKeyError";
    }
}

/**
 * Implementação de {@link StorageService} sobre o sistema de arquivos local.
 *
 * Recebe `rootDir` no construtor (tipicamente `public/uploads`) e cria
 * subdiretórios `yyyy/mm/` sob demanda. Não mantém estado em memória;
 * uma única instância pode ser compartilhada entre requisições.
 */
export class LocalDiskStorage implements StorageService {
    /** Caminho absoluto e canônico do diretório raiz (sem `.`/`..`). */
    private readonly rootResolved: string;

    constructor(rootDir: string) {
        this.rootResolved = path.resolve(rootDir);
    }

    async put(buffer: Buffer, opts: PutOptions): Promise<PutResult> {
        const now = opts.now ?? new Date();
        const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
        const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
        const uuid = randomUUID();
        const safeExt = sanitizeExtension(opts.ext);
        const filename = safeExt ? `${uuid}.${safeExt}` : uuid;
        const key = `${yyyy}/${mm}/${filename}`;

        const fullPath = this.assertWithinRoot(key);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, buffer);

        return { key, sizeBytes: buffer.byteLength };
    }

    async get(key: string): Promise<Buffer> {
        const fullPath = this.assertWithinRoot(key);
        return readFile(fullPath);
    }

    async delete(key: string): Promise<void> {
        const fullPath = this.assertWithinRoot(key);
        try {
            await unlink(fullPath);
        } catch (err) {
            // Idempotência: ausência do arquivo não é erro.
            if (isNodeErrnoException(err) && err.code === "ENOENT") {
                return;
            }
            throw err;
        }
    }

    resolvePath(key: string): string {
        return this.assertWithinRoot(key);
    }

    /**
     * Garante que `key` resolve para um caminho dentro de `rootResolved`.
     *
     * Rejeita:
     * - chaves vazias;
     * - caminhos absolutos (`/foo`, `C:\foo`);
     * - chaves que, após `path.resolve`, escapam do diretório raiz.
     *
     * Aceita tanto `/` quanto `\` na entrada porque o Windows pode
     * propagar separadores nativos via `path.join`. A comparação final
     * usa o caminho absoluto resolvido pelo Node.
     */
    private assertWithinRoot(key: string): string {
        if (typeof key !== "string" || key.length === 0) {
            throw new InvalidStorageKeyError(key);
        }
        if (path.isAbsolute(key)) {
            throw new InvalidStorageKeyError(key);
        }

        const fullPath = path.resolve(this.rootResolved, key);
        const rootWithSep = this.rootResolved.endsWith(path.sep)
            ? this.rootResolved
            : this.rootResolved + path.sep;

        if (fullPath !== this.rootResolved && !fullPath.startsWith(rootWithSep)) {
            throw new InvalidStorageKeyError(key);
        }
        // Bloqueia também o caso de `key` apontar exatamente para o root.
        if (fullPath === this.rootResolved) {
            throw new InvalidStorageKeyError(key);
        }

        return fullPath;
    }
}

/**
 * Normaliza uma extensão removendo ponto inicial e qualquer caractere
 * que não seja alfanumérico. Limita o tamanho a 16 caracteres para
 * impedir extensões absurdas vindas de uploads maliciosos.
 *
 * Retorna string vazia quando a entrada não contém nenhum caractere
 * aproveitável; o chamador trata esse caso gerando um nome sem extensão.
 */
function sanitizeExtension(ext: string): string {
    if (typeof ext !== "string") return "";
    return ext.replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
}

/**
 * Type guard para `NodeJS.ErrnoException`. Necessário porque `catch`
 * recebe `unknown` sob `strict: true`.
 */
function isNodeErrnoException(err: unknown): err is NodeJS.ErrnoException {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        typeof (err as { code: unknown }).code === "string"
    );
}

/**
 * Constrói um {@link StorageService} a partir das variáveis de ambiente.
 *
 * Usa `UPLOAD_DIR` quando definido (caminho absoluto recomendado em
 * produção, p.ex. `/app/public/uploads`); caso contrário, recai em
 * `public/uploads` relativo ao `cwd` — útil para `pnpm dev` e testes.
 */
export function createStorageFromEnv(): StorageService {
    const dir =
        process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
    return new LocalDiskStorage(dir);
}
