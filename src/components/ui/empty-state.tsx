/**
 * Primitivo `EmptyState`.
 *
 * Espaço reservado para situações em que uma lista, tabela ou painel
 * não tem dados a exibir. Espelha o bloco `.empty` da referência visual
 * em `.example/styles.css` (`padding: 60px 20px; text-align: center;`),
 * mas com slots dedicados a ícone, título, descrição e ação.
 *
 * Uso típico:
 *
 * - Tabela de tickets sem resultados após filtros agressivos.
 * - Lista de notificações vazia.
 * - Conversa de ticket sem comentários iniciais.
 *
 * O componente é puramente apresentacional: não toma decisões sobre o
 * que exibir, apenas centraliza o layout e aplica os tokens de cor e
 * tipografia. Componentes de domínio podem montá-lo passando ícones do
 * `lucide-react` e botões do primitivo `Button`.
 *
 * Validates: R19.3
 */

import * as React from "react";

import { cn } from "@/lib/cn";

export interface EmptyStateProps {
    /**
     * Ícone opcional renderizado acima do título. Tamanho recomendado de
     * `size-10` (aplicado automaticamente em SVGs filhos diretos) com a
     * cor `--ink-3` para se manter discreto.
     */
    icon?: React.ReactNode;
    /** Mensagem principal — curta e direta (ex.: "Nenhum ticket aqui"). */
    title: string;
    /**
     * Texto secundário, opcional, com instrução de próximo passo
     * (ex.: "Tente ajustar os filtros ou abra um novo chamado").
     */
    description?: string;
    /**
     * Slot para um call-to-action (botão, link, etc.). Renderizado
     * abaixo da descrição com espaçamento vertical próprio.
     */
    action?: React.ReactNode;
    /** Classes adicionais para customização pontual do contêiner. */
    className?: string;
}

/**
 * Componente `EmptyState`.
 *
 * Estrutura: contêiner flex em coluna, centralizado, com gap vertical
 * consistente. O ícone, quando presente, é envolto em um wrapper que
 * força o tamanho `size-10` e a cor `--ink-3` em SVGs filhos diretos
 * (compatível com ícones do `lucide-react`).
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center gap-2 px-5 py-15 text-center",
                className,
            )}
        >
            {icon ? (
                <span
                    aria-hidden="true"
                    className="mb-2 inline-flex text-(--ink-3) [&_svg]:size-10"
                >
                    {icon}
                </span>
            ) : null}
            <h3 className="text-base font-medium text-(--ink)">{title}</h3>
            {description ? (
                <p className="text-sm text-(--ink-3)">{description}</p>
            ) : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
}
