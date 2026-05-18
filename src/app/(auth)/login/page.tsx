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

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { BRAND_NAME, BRAND_ORG } from "@/lib/brand";

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
        <Card className="w-full max-w-sm">
            <CardHeader>
                <CardTitle>Entrar no {BRAND_NAME}</CardTitle>
                <CardDescription>
                    Central de TI da {BRAND_ORG}.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <LoginForm next={next} />
            </CardContent>
        </Card>
    );
}
