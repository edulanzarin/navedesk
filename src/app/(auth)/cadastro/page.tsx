/**
 * Página `/cadastro` — auto-cadastro público.
 *
 * Server Component que carrega a lista de departamentos (necessária
 * pro select do form) e renderiza o `<RegisterForm>` (Client Component).
 * A criação efetiva acontece via Server Action `registerAction`, que
 * cria contas sempre como `solicitante` e aplica rate limit por IP.
 *
 * Esta tela existe enquanto a base de funcionários é populada — cada
 * pessoa cria a própria conta em vez de o admin cadastrar um por um.
 * Quando todas as contas estiverem ativas, basta remover o link da
 * tela de login e/ou desabilitar a rota.
 */

import Image from "next/image";
import Link from "next/link";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { BRAND_NAME, BRAND_ORG, LOGO_PATH } from "@/lib/brand";
import { listDepartments } from "@/services/reads.service";

import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
    const departments = await listDepartments();

    return (
        <Card
            className={[
                "relative z-10 w-full max-w-[420px] animate-pop",
                "bg-white/65 glass-panel-intense",
                "border-hairline border-(--line-glass)",
                "rounded-(--r-5) shadow-(--sh-pop)",
            ].join(" ")}
        >
            <CardHeader className="flex-col items-center gap-3 pb-2 text-center">
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
                        Criar conta no {BRAND_NAME}
                    </CardTitle>
                    <CardDescription className="mt-1 text-[13.5px]">
                        Suporte de TI {BRAND_ORG}.
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent className="pt-4">
                <RegisterForm departments={departments} />
                <p className="mt-5 text-center text-[12.5px] text-(--ink-3)">
                    Já tem conta?{" "}
                    <Link
                        href="/login"
                        className="font-medium text-(--accent) hover:opacity-80"
                    >
                        Entrar
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
}
