/**
 * Route Handler: `POST /api/uploads`.
 *
 * Recebe um arquivo via `multipart/form-data` e o registra como anexo
 * disponível para vinculação posterior a um ticket ou mensagem. O fluxo
 * impõe uma cadeia de validações curtas e ordenadas, das mais baratas
 * (auth, rate limit, tamanho) para as mais caras (leitura completa do
 * buffer e checagem de magic bytes), de forma a falhar rápido e poupar
 * trabalho quando a requisição já é claramente inválida.
 *
 * Validates: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.9, R22.4.
 */

import { NextResponse, type NextRequest } from "next/server";

import { fileTypeFromBuffer } from "file-type";

import { db } from "@/db/client";
import { insertAttachment } from "@/db/repositories/attachments.repo";
import { auth } from "@/lib/auth";
import {
    UPLOAD_RATE_LIMIT,
    uploadRateLimiter,
} from "@/lib/rate-limit";
import { UploadConstraints, type AllowedMime } from "@/lib/schemas";
import {
    createStorageFromEnv,
    type StorageService,
} from "@/lib/storage";

// O Node runtime é necessário para `Buffer`, `node:crypto` (UUID) e o
// detector `file-type`, que não funciona no edge runtime.
export const runtime = "nodejs";

/** Singleton lazy do storage para reusar a mesma instância entre requisições. */
let storage: StorageService | null = null;
function getStorage(): StorageService {
    if (storage === null) {
        storage = createStorageFromEnv();
    }
    return storage;
}

/**
 * Pequeno helper para padronizar respostas de erro em pt-BR.
 *
 * O corpo expõe apenas `code` e `message`; nunca devolvemos stack traces
 * ou caminhos absolutos do servidor (R22.1, R22.5). O `code` é estável e
 * usado pelo cliente para selecionar a mensagem final ou disparar UX
 * específica (ex.: abrir o seletor de arquivos novamente).
 */
function errorResponse(
    status: number,
    code: string,
    message: string,
): NextResponse {
    return NextResponse.json({ code, message }, { status });
}

/**
 * Verifica se o MIME declarado está na allowlist de upload (R8.2).
 *
 * Tipado como type-guard para que o restante do handler trabalhe com
 * `AllowedMime` em vez de `string`, refletindo no código a invariante
 * já validada.
 */
function isAllowedMime(mime: string): mime is AllowedMime {
    return (UploadConstraints.allowedMime as readonly string[]).includes(mime);
}

/**
 * Tipos textuais aceitos sem assinatura binária detectável.
 *
 * `file-type` é baseado em magic bytes e por isso não reconhece formatos
 * de texto puro (`text/plain`, `text/x-log`). Para esses, exigimos que o
 * MIME declarado seja exatamente um deles — bloqueando, por exemplo, um
 * binário arbitrário disfarçado de `text/plain`.
 */
const TEXT_MIME_WITHOUT_MAGIC: ReadonlySet<AllowedMime> = new Set<AllowedMime>([
    "text/plain",
    "text/x-log",
]);

/**
 * MIMEs equivalentes que `file-type` pode reportar para um mesmo MIME
 * declarado pelo cliente.
 *
 * Caso prático: arquivos `.xlsx` (OOXML) são, na camada de bytes, ZIPs
 * com layout específico; algumas versões do `file-type` retornam
 * `application/zip` ou `application/x-zip` em vez do MIME OOXML
 * completo. Aceitamos esses sinônimos para o MIME XLSX, mas continuamos
 * exigindo que o cliente declare o MIME correto. Para os demais MIMEs
 * (PDF, PNG, JPEG) a comparação é estrita.
 */
const MIME_EQUIVALENTS: Partial<Record<AllowedMime, ReadonlySet<string>>> = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        new Set([
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/zip",
            "application/x-zip",
            "application/x-zip-compressed",
        ]),
};

/**
 * Compara o MIME detectado pelos magic bytes com o MIME declarado.
 *
 * Retorna `true` quando os dois batem exatamente ou quando o detectado
 * está no conjunto de equivalentes aceitos pelo MIME declarado.
 */
function mimesMatch(declared: AllowedMime, detected: string): boolean {
    if (declared === detected) return true;
    const equivalents = MIME_EQUIVALENTS[declared];
    return equivalents !== undefined && equivalents.has(detected);
}

/**
 * Extrai a extensão de um nome de arquivo. Retorna string vazia se não
 * houver `.` ou se a parte após o último `.` estiver vazia, deixando o
 * `LocalDiskStorage` decidir se o caminho final ficará sem extensão.
 */
function extractExtension(filename: string): string {
    const idx = filename.lastIndexOf(".");
    if (idx <= 0 || idx === filename.length - 1) return "";
    return filename.slice(idx + 1);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    // 1) Autenticação (R8.1). 401 antes de tocar no body evita gastar
    //    banda parseando multipart de requisições anônimas.
    const session = await auth();
    if (!session?.user) {
        return errorResponse(
            401,
            "UNAUTHORIZED",
            "Você precisa estar autenticado para enviar arquivos.",
        );
    }

    // 2) Rate limit (R8.9): 30 uploads/min/usuário. Chave = user.id.
    const rl = uploadRateLimiter.check(session.user.id, UPLOAD_RATE_LIMIT);
    if (!rl.allowed) {
        const retryAfter = Math.max(
            1,
            Math.ceil((rl.resetAt - Date.now()) / 1000),
        );
        const res = errorResponse(
            429,
            "RATE_LIMITED",
            "Muitos uploads em sequência. Tente novamente em instantes.",
        );
        res.headers.set("Retry-After", String(retryAfter));
        return res;
    }

    // 3) Parse do multipart. Em caso de Content-Type ausente/errado o
    //    Next lança; transformamos em 400 amigável em vez de 500.
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return errorResponse(
            400,
            "INVALID_MULTIPART",
            "Formato inválido. Envie o arquivo como multipart/form-data.",
        );
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
        return errorResponse(
            400,
            "FILE_REQUIRED",
            'O campo "file" é obrigatório no formulário.',
        );
    }

    // 4) Limite de tamanho (R8.3) — checado antes de ler o buffer para
    //    evitar materializar 25+ MiB só para recusar logo a seguir.
    if (fileEntry.size > UploadConstraints.maxBytes) {
        return errorResponse(
            413,
            "TOO_LARGE",
            "Arquivo excede o limite de 25 MiB.",
        );
    }
    if (fileEntry.size <= 0) {
        return errorResponse(
            400,
            "EMPTY_FILE",
            "Arquivo vazio. Selecione um arquivo válido.",
        );
    }

    // 5) Allowlist de MIME declarado (R8.2). `File.type` pode vir vazio
    //    em alguns clientes; nesse caso já recusamos por tipo inválido.
    const declaredMime = fileEntry.type;
    if (!declaredMime || !isAllowedMime(declaredMime)) {
        return errorResponse(
            415,
            "UNSUPPORTED_MIME",
            "Tipo de arquivo não suportado.",
        );
    }

    // 6) Lê o conteúdo. A partir daqui o custo aumenta, então as etapas
    //    anteriores foram tudo o que conseguimos validar sem buffer.
    const buffer = Buffer.from(await fileEntry.arrayBuffer());

    // 7) Valida magic bytes (R8.4). Para tipos com assinatura binária
    //    conhecida exigimos que o detectado bata com o declarado; para
    //    `text/plain`/`text/x-log` (sem magic bytes) aceitamos quando
    //    o detector não retorna nada — caso contrário um binário não
    //    poderia se passar por texto.
    const detected = await fileTypeFromBuffer(buffer);
    if (detected) {
        if (!mimesMatch(declaredMime, detected.mime)) {
            return errorResponse(
                415,
                "MIME_MISMATCH",
                "O conteúdo do arquivo não corresponde ao tipo declarado.",
            );
        }
    } else if (!TEXT_MIME_WITHOUT_MAGIC.has(declaredMime)) {
        return errorResponse(
            415,
            "MIME_UNDETECTABLE",
            "Não foi possível verificar o tipo do arquivo.",
        );
    }

    // 8) Persiste no storage (R8.5). O nome final no disco é um UUID
    //    com a extensão saneada — o nome original do usuário só vive
    //    em `attachments.name` (metadado), nunca no path do filesystem.
    const ext = extractExtension(fileEntry.name);
    const { key } = await getStorage().put(buffer, { ext });

    // 9) Grava em `attachments` (R8.6) sem vincular a ticket/mensagem
    //    ainda. A vinculação acontece no momento de criar o ticket ou
    //    postar a mensagem, via `linkToTicket`/`linkToMessage`.
    const row = await insertAttachment(db, {
        uploaderId: session.user.id,
        name: fileEntry.name,
        mime: declaredMime,
        sizeBytes: buffer.byteLength,
        storageKey: key,
    });

    // 10) Resposta canônica do upload. `url` aponta para o handler de
    //     download (task 18.3) que aplicará a policy de leitura.
    return NextResponse.json(
        {
            id: row.id,
            url: `/api/uploads/${row.id}`,
            name: row.name,
            size: row.sizeBytes,
            mime: row.mime,
        },
        { status: 201 },
    );
}
