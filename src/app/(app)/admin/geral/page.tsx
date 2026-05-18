/**
 * Página `/admin/geral` (Server Component).
 *
 * Painel administrativo placeholder para as configurações gerais do
 * NaveDesk. Reúne, em uma única tela, ajustes que ainda não têm tela
 * dedicada — branding (logo, cor de acento, nome exibido), fuso horário
 * padrão, idioma e demais preferências globais. Esta primeira versão
 * apenas escala a estrutura: sessão, RBAC, layout e enumeração das
 * configurações planejadas. A persistência de cada item ficará a cargo
 * de tarefas posteriores que conectarão os formulários a Server Actions
 * dedicadas.
 *
 * Responsabilidades do RSC:
 *
 * 1. **Verificar a sessão** via `auth()` e redirecionar para `/login`
 *    quando ausente — defesa em profundidade sobre o middleware
 *    (R1.1, R1.7).
 * 2. **Aplicar RBAC** restringindo o acesso a `admin`. Como a área
 *    `Configurações gerais` ainda não tem policy dedicada em
 *    `lib/policies.ts`, gate por `user.role === "admin"` segue o mesmo
 *    padrão das demais páginas administrativas (R2.8). Não-admins
 *    voltam para `/dashboard` sem feedback de erro.
 * 3. **Renderizar o esqueleto** com `PageHeader` + `Card` listando os
 *    grupos de configurações planejados, mantendo a identidade visual
 *    (paleta índigo, tipografia Geist e raios definidos nos tokens).
 *
 * Conteúdo intencionalmente estático: nenhum formulário é exibido nesta
 * etapa. Quando o trabalho de persistência começar, os blocos abaixo
 * darão lugar a Client Components especializados (ex.: `BrandingForm`,
 * `LocaleForm`) hidratados a partir de leituras do servidor.
 *
 * Validates: R21.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/types/domain";

/**
 * Itens de configuração planejados, listados em ordem de prioridade.
 * Mantidos como dados (e não JSX inline) para facilitar a evolução
 * incremental: cada entrada vira, no futuro, um Client Component
 * próprio com sua Server Action.
 */
const PLANNED_SETTINGS: ReadonlyArray<{
    title: string;
    description: string;
}> = [
        {
            title: "Identidade da marca",
            description:
                "Logo, cor de acento (token --accent) e nome exibido no topo do app.",
        },
        {
            title: "Fuso horário padrão",
            description:
                "Fuso aplicado a datas exibidas e ao cálculo de prazos quando o usuário não definir o próprio.",
        },
        {
            title: "Idioma e formato regional",
            description:
                "Locale padrão para datas, números e mensagens. Atualmente fixo em pt-BR.",
        },
        {
            title: "Tema visual",
            description:
                "Modo claro, escuro ou automático conforme a preferência do sistema.",
        },
        {
            title: "Comunicação interna",
            description:
                "E-mail de origem para notificações e endereço de contato exibido em rodapés.",
        },
    ];

export default async function AdminGeneralSettingsPage() {
    // Sessão obrigatória — middleware já protege, mas o redirect aqui
    // evita que qualquer coisa abaixo execute sem `session.user`.
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    const actor = session.user satisfies SessionUser;

    // RBAC explícito — apenas `admin` opera as configurações gerais.
    // Sem policy dedicada em `lib/policies.ts`, mantemos o gate inline
    // alinhado a R2.8.
    if (actor.role !== "admin") {
        redirect("/dashboard");
    }

    return (
        <div>
            <PageHeader
                title="Configurações gerais"
                description="Ajustes globais do Navedesk"
            />
            <Card>
                <CardHeader>
                    <CardTitle>Em construção</CardTitle>
                    <CardDescription>
                        Esta área concentra preferências que valem para
                        todo o sistema. Os formulários de cada item serão
                        habilitados em entregas futuras; por enquanto, a
                        lista abaixo descreve o escopo planejado.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="flex flex-col gap-3">
                        {PLANNED_SETTINGS.map((setting) => (
                            <li
                                key={setting.title}
                                className="rounded-(--r-3) border border-(--line) bg-(--bg) p-4"
                            >
                                <p className="text-sm font-medium text-(--ink)">
                                    {setting.title}
                                </p>
                                <p className="mt-1 text-sm text-(--ink-3)">
                                    {setting.description}
                                </p>
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
