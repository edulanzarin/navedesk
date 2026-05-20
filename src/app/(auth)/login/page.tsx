/**
 * Página `/login` — entrada do NaveDesk.
 *
 * Server Component responsável por:
 *
 * 1. Ler o parâmetro `next` da query string e normalizá-lo para um
 *    redirect interno seguro (R1.1, R1.4). Aceitamos apenas caminhos
 *    relativos começando com `/`, jamais URLs absolutas — isso evita
 *    open redirect (alguém forjando `?next=https://atacante.com`).
 * 2. Renderizar o `<LoginForm>` (Client Component) passando o `next`
 *    saneado, para que após o submit bem-sucedido o cliente faça
 *    `router.push(next ?? "/dashboard")`.
 *
 * Sem sessão (caminho típico do middleware redirecionando para
 * `/login?next=...`) o usuário cai aqui. A revalidação da sessão é
 * feita pelo `LoginForm` via Server Action.
 *
 * Validates: R1.1, R1.4, R20.1.
 */

import Image from "next/image";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { BRAND_NAME, BRAND_ORG, LOGO_PATH } from "@/lib/brand";

import { LoginForm } from "./login-form";

/** Destino padrão pós-login quando `?next=` ausente ou inválido. */
const DEFAULT_NEXT = "/dashboard";

/**
 * Sanitiza o parâmetro `next` para uso como path interno.
 *
 * Aceita:
 *   - Strings começando com `/` que **não** sejam `//` (proteção contra
 *     `//atacante.com/...`, interpretado como URL protocol-relative).
 *
 * Qualquer outro valor (ausente, array — quando o Next entrega múltiplos
 * `?next=`, URL absoluta) cai em `DEFAULT_NEXT`.
 */
function sanitizeNext(value: string | string[] | undefined): string {
    if (typeof value !== "string") return DEFAULT_NEXT;
    if (!value.startsWith("/")) return DEFAULT_NEXT;
    if (value.startsWith("//")) return DEFAULT_NEXT;
    return value;
}

interface LoginPageProps {
    /**
     * Em Next 15 `searchParams` é uma `Promise` que precisa ser
     * `await`-ada antes do uso (mudança de contrato dos Server
     * Components dinâmicos).
     */
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const params = await searchParams;
    const next = sanitizeNext(params.next);

    return (
        <Card
            className={[
                "relative z-10 w-full max-w-[380px] animate-pop",
                "bg-white/65 glass-panel-intense",
                "border-hairline border-(--line-glass)",
                "rounded-(--r-5) shadow-(--sh-pop)",
            ].join(" ")}
        >
            <CardHeader className="flex-col items-start gap-3 pb-2">
                <Image
                    src={LOGO_PATH}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 object-contain"
                    priority
                />
                <div>
                    <CardTitle className="text-[22px] font-semibold tracking-[-0.025em]">
                        Entrar no {BRAND_NAME}
                    </CardTitle>
                    <CardDescription className="mt-1 text-[13.5px]">
                        Central de TI da {BRAND_ORG}.
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent className="pt-4">
                <LoginForm next={next} />
            </CardContent>
        </Card>
    );
}
