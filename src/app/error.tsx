/**
 * Boundary global de erros (`error.tsx`).
 *
 * Client Component obrigatório (contrato do App Router) capturado pelo
 * Next.js sempre que uma exceção não tratada estoura durante o render
 * de uma rota — incluindo erros lançados dentro de Server Components,
 * Server Actions ou Route Handlers que cheguem até o framework.
 *
 * Princípios:
 *
 * 1. **Sem vazamento de internals** (R22.5): nunca renderizamos
 *    `error.message` ou `error.stack`. O usuário vê apenas uma cópia
 *    genérica em pt-BR; o `error.digest` (hash opaco gerado pelo Next
 *    em produção) é exibido em texto pequeno e logado para
 *    correlação de suporte, sem revelar detalhes técnicos.
 * 2. **Logging estruturado server-side**: em desenvolvimento o
 *    `console.error` cai no terminal do dev server; em produção, o
 *    runtime do Next já encaminha o erro original (com stack) para o
 *    log do servidor antes de chamar este componente. Aqui logamos um
 *    JSON enxuto com `digest` + `name` para correlacionar o que o
 *    usuário viu (eventualmente compartilha o digest com o suporte)
 *    com o que está nos logs estruturados do servidor.
 * 3. **Recuperação amigável**: o botão "Tentar novamente" chama
 *    `reset()`, que pede ao Next para re-renderizar o segmento que
 *    falhou — funciona para erros transitórios (ex.: timeout
 *    momentâneo de banco) sem exigir reload completo.
 * 4. **Caminho de fuga**: link secundário para `/dashboard` cobre o
 *    cenário em que o erro persiste e o usuário prefere voltar à
 *    home autenticada.
 *
 * Notas operacionais:
 *
 * - Como `error.tsx` na raiz, este boundary captura tudo que escapa
 *   de boundaries mais específicos. Seu layout próprio (sem
 *   `Sidebar`/`Topbar`) é intencional: se o erro ocorreu antes do
 *   layout autenticado renderizar, exibir o cromo do app pode causar
 *   um segundo erro em cascata. A página fica auto-suficiente.
 * - O efeito de log roda apenas no cliente. Para logging server-side
 *   estruturado da exceção em si, o Next já faz isso no log do
 *   servidor. Este `console.error` provê uma trilha adicional do
 *   lado do cliente, útil ao depurar com DevTools abertos.
 *
 * Validates: R20.1, R22.5.
 */

"use client";

import { useEffect } from "react";

import Link from "next/link";

import { Button } from "@/components/ui/button";

interface GlobalErrorProps {
    /**
     * Erro original lançado pelo framework. **Nunca** é renderizado:
     * apenas inspecionamos `error.digest` e `error.name` para fins de
     * logging/correlação.
     */
    error: Error & { digest?: string };
    /**
     * Função fornecida pelo Next que tenta re-renderizar o segmento
     * que falhou. Usada pelo botão "Tentar novamente".
     */
    reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
    useEffect(() => {
        // Log estruturado client-side. O Next.js já encaminha o erro
        // completo (incluindo stack) para o log do servidor antes de
        // este componente montar; aqui apenas registramos um JSON
        // enxuto para correlação ao depurar com DevTools.
        // Nunca expomos `error.message` na UI — só no console.
        // eslint-disable-next-line no-console
        console.error("[NaveDesk] Erro de renderização", {
            name: error.name,
            digest: error.digest ?? null,
            message: error.message,
        });
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-(--bg) px-4 py-10">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <p className="font-mono text-sm tracking-widest text-(--ink-3)">
                    500
                </p>
                <h1 className="text-2xl font-semibold tracking-tight text-(--ink)">
                    Algo deu errado
                </h1>
                <p className="text-sm text-(--ink-3)">
                    Ocorreu um erro inesperado ao processar sua solicitação.
                    Tente novamente em instantes; se o problema persistir,
                    informe o código abaixo ao suporte.
                </p>
                {error.digest ? (
                    <p
                        className="font-mono text-xs text-(--ink-3) select-all"
                        aria-label="Código de correlação do erro"
                    >
                        ID: {error.digest}
                    </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <Button
                        type="button"
                        variant="primary"
                        onClick={() => reset()}
                    >
                        Tentar novamente
                    </Button>
                    <Button asChild variant="default">
                        <Link href="/dashboard">Voltar ao início</Link>
                    </Button>
                </div>
            </div>
        </main>
    );
}
