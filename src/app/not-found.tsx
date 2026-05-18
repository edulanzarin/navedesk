/**
 * Página global `not-found.tsx`.
 *
 * Server Component capturado pelo App Router do Next.js sempre que uma
 * rota chama `notFound()` ou um pathname não corresponde a nenhuma
 * página. Por estar no nível raiz de `src/app`, é o fallback para
 * grupos de rota que não têm um `not-found.tsx` próprio (rotas
 * anônimas, rotas externas a `(app)`, e qualquer URL inexistente).
 *
 * Princípios:
 *
 * 1. **Mensagem amigável em pt-BR** (R20.1): nada de "Page not found"
 *    nem stack/erro técnico — apenas explicação curta e ação.
 * 2. **Sem vazamento de informação** (R22.6): a página é genérica e
 *    não diferencia "rota inexistente" de "recurso inexistente / sem
 *    permissão" — esse é exatamente o comportamento desejado para o
 *    fluxo de detalhe de ticket e KB, que chamam `notFound()` em
 *    ambas as situações.
 * 3. **Caminho de retorno seguro**: link para `/dashboard`, que o
 *    middleware redireciona para `/login` se a sessão estiver
 *    ausente. Assim a página funciona tanto para visitantes anônimos
 *    quanto para autenticados sem precisar saber o estado da sessão.
 * 4. **Server Component puro**: sem hooks, sem `"use client"`, para
 *    minimizar custo de hidratação numa página utilitária.
 *
 * O layout não monta `Sidebar`/`Topbar` por design — esta página é o
 * fallback global, então não pressupõe sessão. Páginas dentro de
 * `(app)` que precisem de 404 com cromia do app autenticado são
 * cobertas por `src/app/(app)/not-found.tsx`.
 *
 * Validates: R20.1, R22.6.
 */

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-(--bg) px-4 py-10">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <p className="font-mono text-sm tracking-widest text-(--ink-3)">
                    404
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">
                    Página não encontrada
                </h1>
                <p className="text-sm text-(--ink-3)">
                    O endereço acessado não existe ou foi movido. Verifique o
                    link e tente novamente.
                </p>
                <Button asChild variant="primary" className="mt-2">
                    <Link href="/dashboard">Voltar ao início</Link>
                </Button>
            </div>
        </main>
    );
}
