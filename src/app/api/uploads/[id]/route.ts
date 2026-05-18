/**
 * Route Handler: `GET /api/uploads/[id]`.
 *
 * Devolve o conteúdo binário de um anexo previamente registrado por
 * `POST /api/uploads`. A leitura é **defensiva** quanto à privacidade:
 * "anexo inexistente" e "RBAC negado" produzem o mesmo `404` sem corpo,
 * evitando enumeração de IDs e vazamento de existência (R8.7, R22.6).
 * Requisições sem sessão recebem `401` para sinalizar ao cliente que
 * basta autenticar — alinhado com o comportamento do POST.
 *
 * Para anexos que não são imagens, força-se `Content-Disposition: attachment`
 * de modo que o navegador inicie o download em vez de renderizar inline —
 * isso reduz a superfície de XSS via `text/plain` ou PDFs maliciosos
 * (R8.8). Imagens permanecem inline para uso natural em previews.
 *
 * Validates: R8.7, R8.8, R22.6.
 */

import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db/client";
import { findById } from "@/db/repositories/attachments.repo";
import { findTicketById } from "@/db/repositories/tickets.repo";
import { auth } from "@/lib/auth";
import { canReadAttachment } from "@/lib/policies";
import {
    createStorageFromEnv,
    type StorageService,
} from "@/lib/storage";

// `Buffer` e leitura de disco exigem o Node runtime; o detector
// `file-type` usado no upload também não roda no edge.
export const runtime = "nodejs";

/**
 * Singleton lazy do storage. Mantém uma única instância de
 * `LocalDiskStorage` entre requisições para evitar resolver `rootDir`
 * a cada chamada.
 */
let storage: StorageService | null = null;
function getStorage(): StorageService {
    if (storage === null) {
        storage = createStorageFromEnv();
    }
    return storage;
}

/**
 * Resposta padrão para os dois casos indistinguíveis (R8.7, R22.6):
 * anexo inexistente e RBAC negado. Sempre `404` sem corpo, sem
 * cabeçalho que possa pista o motivo.
 */
function notFound(): NextResponse {
    return new NextResponse(null, { status: 404 });
}

/**
 * Resposta de não-autenticado. Mantida separada de {@link notFound}
 * porque "sem sessão" é uma condição que o cliente pode resolver
 * (basta logar) — não há vazamento de existência envolvido.
 */
function unauthorized(): NextResponse {
    return NextResponse.json(
        {
            code: "UNAUTHORIZED",
            message:
                "Você precisa estar autenticado para baixar arquivos.",
        },
        { status: 401 },
    );
}

/**
 * Codifica `filename` para uso em `Content-Disposition` segundo RFC 6266.
 *
 * Faz duas coisas:
 *
 * 1. Sanitiza um fallback ASCII removendo caracteres de controle e
 *    aspas, garantindo um header válido em qualquer cliente legado.
 * 2. Adiciona `filename*=UTF-8''...` percent-encoded para clientes
 *    modernos preservarem acentuação (RFC 5987).
 *
 * Mantemos os dois para máxima compatibilidade — exatamente o que
 * navegadores atuais esperam.
 */
function buildContentDisposition(filename: string): string {
    // Fallback ASCII: remove controles, barras e aspas; troca tudo
    // que sai de [\x20-\x7E] por `_` para preservar legibilidade.
    const asciiFallback = filename
        .replace(/[\x00-\x1F\x7F"\\]/g, "_")
        .replace(/[^\x20-\x7E]/g, "_");

    // RFC 5987: percent-encode preservando apenas o conjunto
    // `attr-char` da especificação. `encodeURIComponent` cobre tudo
    // que precisamos exceto `'`, que substituímos manualmente.
    const utf8Encoded = encodeURIComponent(filename).replace(/'/g, "%27");

    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
    // 1) Autenticação. Sem sessão devolvemos 401 para que o cliente
    //    saiba que basta logar; só negações de RBAC propriamente ditas
    //    se fundem com "não existe" no 404 (R8.7/R22.6).
    const session = await auth();
    if (!session?.user) {
        return unauthorized();
    }

    const { id } = await ctx.params;

    // 2) Carrega o anexo. UUID inválido pode lançar no driver; se isso
    //    ocorrer, o 404 é imposto pelo `try/catch` implícito do Next
    //    apenas para erros de driver — aqui consideramos "id mal-formado"
    //    como "não existe" e devolvemos 404.
    let att;
    try {
        att = await findById(db, id);
    } catch {
        return notFound();
    }
    if (!att) {
        return notFound();
    }

    // 3) Carrega o ticket associado, se houver. Anexos órfãos
    //    (`ticketId === null`) ainda no fluxo de upload são lidos pelo
    //    próprio uploader; `canReadAttachment` cuida desse caso sem
    //    precisar do ticket.
    const ticket = att.ticketId
        ? await findTicketById(db, att.ticketId)
        : null;

    // 4) RBAC. Negação devolve 404 (não 403) para não revelar existência.
    if (!canReadAttachment(session.user, att, ticket)) {
        return notFound();
    }

    // 5) Lê os bytes do storage. Falha de I/O (ex.: arquivo removido
    //    fora do app) cai como 404 — do ponto de vista do cliente, o
    //    recurso não está acessível.
    let buffer: Buffer;
    try {
        buffer = await getStorage().get(att.storageKey);
    } catch {
        return notFound();
    }

    // 6) Monta os cabeçalhos. `Content-Type` reflete o MIME validado
    //    no upload; `Content-Length` permite progresso no cliente; e
    //    para tipos não-imagem aplicamos `Content-Disposition: attachment`
    //    com filename RFC 6266/5987 para forçar download e preservar
    //    acentuação no nome (R8.8).
    const isImage = att.mime.startsWith("image/");
    const headers = new Headers();
    headers.set("Content-Type", att.mime);
    headers.set("Content-Length", String(buffer.byteLength));
    if (!isImage) {
        headers.set(
            "Content-Disposition",
            buildContentDisposition(att.name),
        );
    }
    // Cache privado: o conteúdo é específico do usuário (RBAC) e não
    // deve ser cacheado por proxies compartilhados.
    headers.set("Cache-Control", "private, max-age=0, must-revalidate");

    // `NextResponse` aceita `Buffer` (Uint8Array) como body; o framework
    // se encarrega de propagar como stream binário.
    return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers,
    });
}
