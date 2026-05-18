/**
 * Componente cliente `SlaAlertBanner`.
 *
 * Faixa de alerta exibida no topo do dashboard quando há tickets ativos
 * com SLA já vencido (`level === "breached"`) ou prestes a vencer
 * (`level === "crit"`, ≤ 10% do prazo restante). Cada tipo recebe um
 * tratamento visual distinto:
 *
 * - **Violado** — borda/fundo vermelho com ícone `OctagonAlert` (R10.5,
 *   condição "atenção máxima"); a frase de cabeçalho usa o termo
 *   pt-BR "SLA violado" para casar com o vocabulário da máquina de
 *   estados.
 * - **Em atenção** — borda/fundo âmbar com ícone `AlertTriangle`,
 *   correspondendo ao bucket `crit` do `computeSlaInfo` (acabou o
 *   "respiro" mas ainda há prazo para reagir).
 *
 * Por que Client Component? O banner em si não precisa de hooks ou
 * efeitos — a classificação `breached`/`crit` é feita no servidor, no
 * `dashboard/page.tsx`, contra o instante da requisição. Ainda assim
 * mantemos `"use client"` por dois motivos: (1) garante que `Link`
 * gere transições de cliente nativas e fluidas para o detalhe do
 * ticket, e (2) deixa espaço para evolução futura (por exemplo, um
 * `setInterval` que reavalie tickets perto do limiar sem precisar de
 * full reload).
 *
 * Convenções:
 *
 * - Strings em pt-BR (R20.4).
 * - Cada item da lista é um `<Link>` para `/tickets/[id]` (R12.7
 *   garante que solicitantes só vejam seus próprios tickets — o filtro
 *   é aplicado upstream em `dashboard/page.tsx`).
 * - Ambas as listas vazias → o componente retorna `null` para que o
 *   contêiner não reserve espaço (R10.5: o destaque visual só aparece
 *   "WHEN existir pelo menos um ticket").
 * - `maxPerSection` limita quantos tickets aparecem por bloco; o
 *   excedente vira "+N outros tickets não exibidos" para evitar que o
 *   banner cresça indefinidamente em incidentes.
 *
 * Validates: R10.5.
 */

"use client";

import Link from "next/link";

import { AlertTriangle, OctagonAlert, type LucideIcon } from "lucide-react";

import { PriorityPill } from "@/components/domain/priority-pill";
import { cn } from "@/lib/cn";
import type { Priority } from "@/types/domain";

/**
 * Linha mínima de ticket exibida no banner.
 *
 * Mantemos o shape enxuto — não trafegamos a entidade `Ticket` inteira
 * porque o banner só precisa de `id` (link e identificador legível),
 * `title` (rótulo) e `priority` (pílula colorida). Manter o contrato
 * pequeno reduz acoplamento entre a página do dashboard e o componente.
 */
export interface SlaAlertBannerTicket {
    /** Identificador legível, p.ex. `"NVD-1043"`. */
    id: string;
    title: string;
    priority: Priority;
}

export interface SlaAlertBannerProps {
    /** Tickets com `level === "breached"` (prazo já vencido). */
    breached: SlaAlertBannerTicket[];
    /**
     * Tickets com `level === "crit"`: prazo ainda não vencido, mas
     * com ≤ 10% de tempo restante.
     */
    atRisk: SlaAlertBannerTicket[];
    /**
     * Quantos tickets exibir por bloco antes de colapsar o restante em
     * "+N outros tickets". Default 5.
     */
    maxPerSection?: number;
}

/** Default conservador para evitar banners muito longos em incidentes. */
const DEFAULT_MAX_PER_SECTION = 5;

/** Tipos internos que distinguem os dois tratamentos visuais. */
type SectionTone = "breached" | "atRisk";

/**
 * Mapeamento dos tons aceitos para classes utilitárias e ícone Lucide.
 *
 * Mantemos as classes em strings literais para que o Tailwind v4 detecte
 * todas durante o build estático. Os tokens (`--red`, `--red-soft`,
 * `--amber`, `--amber-soft`) vêm de `styles/tokens.css` e são a fonte
 * única da paleta.
 */
const SECTION_STYLES = {
    breached: {
        container: "border-(--red) bg-(--red-soft)",
        icon: "text-(--red)",
        Icon: OctagonAlert as LucideIcon,
    },
    atRisk: {
        container: "border-(--amber) bg-(--amber-soft)",
        icon: "text-(--amber)",
        Icon: AlertTriangle as LucideIcon,
    },
} as const satisfies Record<
    SectionTone,
    { container: string; icon: string; Icon: LucideIcon }
>;

/**
 * Faixa de alerta do dashboard. Renderiza até dois blocos empilhados —
 * primeiro os tickets já violados, depois os em atenção — para que a
 * urgência maior fique no topo.
 */
export function SlaAlertBanner({
    breached,
    atRisk,
    maxPerSection = DEFAULT_MAX_PER_SECTION,
}: SlaAlertBannerProps) {
    // R10.5: o destaque visual só aparece quando há ao menos um ticket.
    if (breached.length === 0 && atRisk.length === 0) return null;

    return (
        <div
            role="alert"
            aria-live="polite"
            className="mb-6 flex flex-col gap-3"
        >
            {breached.length > 0 ? (
                <Section
                    tone="breached"
                    title="SLA violado"
                    description={describeBreached(breached.length)}
                    tickets={breached}
                    max={maxPerSection}
                />
            ) : null}
            {atRisk.length > 0 ? (
                <Section
                    tone="atRisk"
                    title="SLA em atenção"
                    description={describeAtRisk(atRisk.length)}
                    tickets={atRisk}
                    max={maxPerSection}
                />
            ) : null}
        </div>
    );
}

/**
 * Frase de cabeçalho do bloco "violado". Pluraliza explicitamente em
 * pt-BR para evitar concordância estranha em casos limite (1 ticket).
 */
function describeBreached(count: number): string {
    return count === 1
        ? "1 ticket ativo está com o prazo de SLA vencido."
        : `${count} tickets ativos estão com o prazo de SLA vencido.`;
}

/**
 * Frase de cabeçalho do bloco "em atenção". Mesma motivação de
 * pluralização explícita.
 */
function describeAtRisk(count: number): string {
    return count === 1
        ? "1 ticket ativo está prestes a violar o SLA."
        : `${count} tickets ativos estão prestes a violar o SLA.`;
}

interface SectionProps {
    tone: SectionTone;
    title: string;
    description: string;
    tickets: SlaAlertBannerTicket[];
    max: number;
}

/**
 * Bloco interno reutilizável: ícone à esquerda, título + descrição +
 * lista clicável à direita. Não é exportado porque o cabeçalho dos
 * blocos é específico deste banner.
 */
function Section({ tone, title, description, tickets, max }: SectionProps) {
    const visible = tickets.slice(0, max);
    const overflow = tickets.length - visible.length;
    const styles = SECTION_STYLES[tone];
    const Icon = styles.Icon;

    return (
        <div
            className={cn(
                "flex items-start gap-3 rounded-(--r-3) border p-4",
                styles.container,
            )}
        >
            <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-5 shrink-0", styles.icon)}
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-(--ink)">{title}</p>
                <p className="mt-0.5 text-sm text-(--ink-3)">{description}</p>
                <ul className="mt-3 flex flex-col gap-1.5">
                    {visible.map((ticket) => (
                        <li
                            key={ticket.id}
                            className="flex min-w-0 items-center gap-2"
                        >
                            <Link
                                href={`/tickets/${ticket.id}`}
                                className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline focus-visible:underline focus-visible:outline-none"
                            >
                                <span className="font-mono text-(--ink-2)">
                                    {ticket.id}
                                </span>
                                <span className="truncate text-(--ink)">
                                    {ticket.title}
                                </span>
                            </Link>
                            <PriorityPill priority={ticket.priority} />
                        </li>
                    ))}
                </ul>
                {overflow > 0 ? (
                    <p className="mt-2 text-xs text-(--ink-3)">
                        +{overflow}{" "}
                        {overflow === 1
                            ? "outro ticket não exibido."
                            : "outros tickets não exibidos."}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
