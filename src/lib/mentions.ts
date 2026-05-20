/**
 * Resolução de menções `@nome` em mensagens de tickets.
 *
 * Sintaxe aceita:
 * - `@usuario` — letras (com acentos), dígitos, ponto e underscore.
 * - `@nome.sobrenome` — primeiro nome + sobrenome separados por ponto
 *   (forma natural quando o "handle" do usuário é gerado a partir do
 *   nome completo).
 *
 * Estratégia de match:
 * 1. Extrai todos os candidatos com regex.
 * 2. Compara contra a lista de usuários ativos pelo nome (lowercase,
 *    sem acentos), aceitando primeiro nome OU primeiro+sobrenome.
 * 3. Em caso de ambiguidade (dois João Silva, p.ex.), nenhum dos dois
 *    é resolvido — só matches únicos viram menção.
 *
 * Isso é deliberadamente simples: o objetivo é cobrir o caso comum
 * sem montar um sistema de "handles" no banco. Se virar dor, dá pra
 * adicionar uma coluna `users.handle UNIQUE` e bater por igualdade
 * exata.
 */

export interface MentionCandidate {
    /** ID do usuário resolvido. */
    userId: string;
    /** Nome canônico exibido. */
    name: string;
}

export interface MentionableUser {
    id: string;
    name: string;
}

/** Regex que captura tokens `@palavra(.palavra)?`. */
const MENTION_RE = /@([a-zA-ZÀ-ÿ0-9_]+(?:\.[a-zA-ZÀ-ÿ0-9_]+)?)/g;

/**
 * Normaliza string para comparação: minúsculas + remoção de acentos.
 * Mantém-se uma utilidade local (não importa de format) para facilitar
 * testes unitários e cobrir caracteres ibéricos comuns.
 */
function normalize(input: string): string {
    return input
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Constrói tokens normalizados a partir do nome de um usuário.
 *
 * Para "João Silva" devolve:
 * - `joao`           (primeiro nome)
 * - `joao.silva`     (primeiro + sobrenome separados por ponto)
 *
 * Caso o usuário tenha apenas um nome, devolve só o primeiro.
 */
function tokensForUser(name: string): string[] {
    const parts = normalize(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return [];
    const first = parts[0]!;
    if (parts.length === 1) return [first];
    const last = parts[parts.length - 1]!;
    return [first, `${first}.${last}`];
}

/**
 * Extrai os tokens `@xxx` (sem o `@`) presentes no `body`. Útil para
 * o renderer que destaca as menções no front.
 */
export function extractMentionTokens(body: string): string[] {
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(MENTION_RE.source, "g");
    while ((m = re.exec(body)) !== null) {
        if (m[1]) matches.push(m[1]);
    }
    return matches;
}

/**
 * Resolve menções no `body` contra a lista de usuários informada.
 *
 * Devolve:
 * - `userIds`: array de IDs únicos efetivamente mencionados (matches
 *   ambíguos são ignorados).
 * - `byToken`: mapa `token-original → userId | null`. `null` quando
 *   o token não bate com ninguém ou bate com múltiplos.
 *
 * O caller pode passar a lista completa de usuários ativos. Para
 * conversas em tickets onde o universo é grande, a função é O(N · M)
 * com N = candidatos no texto, M = usuários — barato pra mensagens
 * curtas e bases de até alguns milhares de usuários.
 */
export function resolveMentions(
    body: string,
    users: readonly MentionableUser[],
): { userIds: string[]; byToken: Map<string, string | null> } {
    const tokens = extractMentionTokens(body);
    const byToken = new Map<string, string | null>();
    const userIds = new Set<string>();

    if (tokens.length === 0 || users.length === 0) {
        return { userIds: [], byToken };
    }

    // Index por token normalizado → list de userIds que respondem a ele.
    const tokenIndex = new Map<string, string[]>();
    for (const u of users) {
        for (const t of tokensForUser(u.name)) {
            const list = tokenIndex.get(t) ?? [];
            list.push(u.id);
            tokenIndex.set(t, list);
        }
    }

    for (const token of tokens) {
        const norm = normalize(token);
        const matches = tokenIndex.get(norm);
        if (!matches || matches.length === 0) {
            byToken.set(token, null);
            continue;
        }
        if (matches.length > 1) {
            // Ambíguo — não resolvemos.
            byToken.set(token, null);
            continue;
        }
        const id = matches[0]!;
        byToken.set(token, id);
        userIds.add(id);
    }

    return { userIds: Array.from(userIds), byToken };
}
