/**
 * Página `not-found.tsx` do grupo `(app)`.
 *
 * Server Component capturado pelo App Router do Next.js sempre que uma
 * rota dentro do grupo autenticado chama `notFound()` (detalhe de
 * ticket inexistente/sem permissão, artigo de KB ausente, etc.) ou
 * quando um pathname dentro de `(app)/...` não casa com nenhuma
 * página.
 *
 * Por estar dentro do grupo `(app)`, herda automaticamente
 * `src/app/(app)/layout.tsx` — ou seja, é renderizada com `Sidebar` e
 * `Topbar` montadas e a sessão já validada. Isso preserva a sensação
 * de continuidade quando o usuário cai num 404 enquanto navega no
 * produto.
 *
 * Princípios:
 *
 * 1. **Mensagem amigável em pt-BR** (R20.1): nada de "Page not found"
 *    nem detalhe técnico.
 * 2. **Sem vazamento de informação** (R22.6): a copy é genérica e
 *    igual para "rota inexistente" e "recurso sem permissão" — exatamente
 *    o caminho exigido por `findVisibleForUser` e `getArticleBySlug`,
 *    que retornam `null`/`NOT_FOUND` em ambos os casos.
 * 3. **Caminho de retorno**: `Voltar ao painel` envia para `/dashboard`,
 *    que sempre existe para qualquer papel autenticado.
 * 4. **Server Component puro**: sem hooks, sem `"use client"`.
 *
 * Validates: R20.1, R22.6.
 */

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AppNotFound() {
    return (
        <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <p className="font-mono text-sm tracking-widest text-(--ink-3)">
                    404
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">
                    Página não encontrada
                </h1>
                <p className="text-sm text-(--ink-3)">
                    O recurso que você procura não existe ou não está disponível
                    para o seu usuário.
                </p>
                <Button asChild variant="primary" className="mt-2">
                    <Link href="/dashboard">Voltar ao painel</Link>
                </Button>
            </div>
        </div>
    );
}
