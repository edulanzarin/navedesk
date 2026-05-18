/**
 * Mensagens de erro padronizadas em pt-BR.
 *
 * Centraliza, num único módulo, o mapa `code → mensagem amigável` para
 * todos os códigos retornados por Server Actions, services e Route
 * Handlers do NaveDesk. O objetivo é garantir que toasts e demais
 * consumidores da UI nunca exibam uma string vazia, indefinida ou em
 * inglês quando o servidor não oferecer uma mensagem específica.
 *
 * Política de consumo (R20.1, R22.1, R22.2, R22.3):
 *
 * 1. Quando um service ou action devolve `ActionResult.error.message`
 *    com texto significativo (ex.: validações Zod com `field`,
 *    transições inválidas com nomes de status), a UI deve preferir
 *    essa mensagem — ela é mais contextual do que o fallback genérico.
 * 2. Quando `error.message` está ausente ou é o texto genérico do
 *    framework, a UI cai no mapa `ERROR_MESSAGES` indexado por `code`.
 * 3. Se o `code` também não estiver mapeado (caso defensivo, ex.: erro
 *    inesperado vindo de uma camada externa), o helper devolve uma
 *    mensagem genérica em pt-BR pedindo nova tentativa.
 *
 * Esta camada deliberadamente NÃO re-traduz mensagens já em pt-BR
 * vindas do servidor: a fonte canônica de mensagens contextuais
 * continua sendo o service que conhece os detalhes do domínio. O mapa
 * existe para preencher lacunas, padronizar tom e evitar `undefined`
 * em superfícies do cliente.
 *
 * Validates: R20.1, R22.1, R22.2, R22.3.
 */

/**
 * Mensagem genérica usada quando nenhum `code` conhecido bate e o
 * servidor não forneceu texto. Mantida em uma constante exportada
 * para que testes possam assertar diretamente sobre ela.
 */
export const DEFAULT_ERROR_MESSAGE =
    "Ocorreu um erro inesperado. Tente novamente.";

/**
 * Mapa canônico de códigos de erro para mensagens em pt-BR.
 *
 * Cobre todos os códigos efetivamente retornados pela aplicação:
 *
 * - Auth/sessão: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_CREDENTIALS`,
 *   `RATE_LIMITED`.
 * - Validação: `VALIDATION`, `VALIDATION_ERROR`.
 * - Recursos: `NOT_FOUND`, `CONFLICT`, `IN_USE`.
 * - Tickets: `INVALID_TRANSITION`, `ILLEGAL_TRANSITION` (alias do
 *   design), `INVALID_ASSIGNEE`, `ATTACHMENT_INVALID`.
 * - Exportação: `TOO_MANY_ROWS`, `NOT_IMPLEMENTED`.
 * - Uploads: `INVALID_MULTIPART`, `FILE_REQUIRED`, `TOO_LARGE`,
 *   `EMPTY_FILE`, `UNSUPPORTED_MIME`, `MIME_MISMATCH`,
 *   `MIME_UNDETECTABLE`.
 *
 * Novos códigos adicionados em services devem ganhar entrada aqui na
 * mesma PR para que a UI nunca caia no fallback genérico.
 */
export const ERROR_MESSAGES: Record<string, string> = {
    // Autenticação e sessão
    UNAUTHORIZED: "Sua sessão expirou. Entre novamente para continuar.",
    FORBIDDEN: "Você não tem permissão para executar esta operação.",
    INVALID_CREDENTIALS: "Credenciais inválidas. Verifique e tente novamente.",
    RATE_LIMITED:
        "Muitas tentativas em sequência. Aguarde alguns instantes e tente novamente.",

    // Validação de entrada
    VALIDATION: "Dados inválidos. Revise os campos e tente novamente.",
    VALIDATION_ERROR: "Dados inválidos. Revise os campos e tente novamente.",

    // Recursos
    NOT_FOUND: "Registro não encontrado.",
    CONFLICT: "Já existe um registro com esses dados.",
    IN_USE: "Este registro está em uso e não pode ser removido.",

    // Tickets — máquina de estados, atribuição e anexos
    INVALID_TRANSITION:
        "Esta transição de status não é permitida para o ticket.",
    ILLEGAL_TRANSITION:
        "Esta transição de status não é permitida para o ticket.",
    INVALID_ASSIGNEE: "Responsável inválido para o ticket.",
    ATTACHMENT_INVALID:
        "Um ou mais anexos informados não puderam ser vinculados.",

    // Exportação
    TOO_MANY_ROWS:
        "O filtro retornou tickets demais. Refine os filtros e tente novamente.",
    NOT_IMPLEMENTED: "Funcionalidade ainda não disponível.",

    // Uploads (Route Handler /api/uploads)
    INVALID_MULTIPART:
        "Formato inválido. Envie o arquivo como multipart/form-data.",
    FILE_REQUIRED: "Selecione um arquivo para enviar.",
    TOO_LARGE: "Arquivo excede o limite de 25 MiB.",
    EMPTY_FILE: "Arquivo vazio. Selecione um arquivo válido.",
    UNSUPPORTED_MIME: "Tipo de arquivo não suportado.",
    MIME_MISMATCH:
        "O conteúdo do arquivo não corresponde ao tipo declarado.",
    MIME_UNDETECTABLE: "Não foi possível verificar o tipo do arquivo.",
};

/**
 * Forma mínima esperada por `getErrorMessage`. Compatível com o ramo
 * `ok: false` de `ActionResult` (`{ code: string; message: string }`)
 * e também com respostas JSON de Route Handlers que possam omitir
 * `message`.
 */
export interface ErrorPayload {
    code: string;
    message?: string | null;
}

/**
 * Resolve a mensagem que deve ser exibida ao usuário, preferindo, em
 * ordem:
 *
 * 1. `error.message` quando o servidor enviou texto não vazio.
 * 2. `ERROR_MESSAGES[error.code]` quando o `code` é conhecido.
 * 3. `DEFAULT_ERROR_MESSAGE` como fallback final.
 *
 * Aceita `null`/`undefined` para tolerar shapes inesperados (ex.: erro
 * de rede que ainda não tem `code`) sem que a UI quebre — nesses casos
 * também devolve a mensagem genérica.
 *
 * @example
 * ```ts
 * const result = await createTicketAction(input);
 * if (!result.ok) {
 *     toast({ variant: "error", description: getErrorMessage(result.error) });
 * }
 * ```
 */
export function getErrorMessage(
    error: ErrorPayload | null | undefined,
): string {
    if (!error) return DEFAULT_ERROR_MESSAGE;

    const trimmed = typeof error.message === "string" ? error.message.trim() : "";
    if (trimmed.length > 0) return trimmed;

    const mapped = ERROR_MESSAGES[error.code];
    if (mapped) return mapped;

    return DEFAULT_ERROR_MESSAGE;
}
