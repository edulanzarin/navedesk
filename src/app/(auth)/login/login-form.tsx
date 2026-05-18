/**
 * `LoginForm` — formulário de credenciais da rota `/login`.
 *
 * Client Component porque combina `react-hook-form` + `zodResolver` para
 * validação no cliente (UX rápida, sem ida ao servidor) e usa o
 * `useRouter` para fazer o redirect pós-login preservando o parâmetro
 * `next` saneado pela `LoginPage`.
 *
 * Fluxo:
 *
 * 1. Valida `email` (formato) e `password` (não vazio) via Zod ANTES de
 *    submeter — evita chamar a Server Action com payload claramente
 *    inválido.
 * 2. Chama `loginAction({ email, password })`. A action aplica o rate
 *    limit (R1.9) e delega ao `signIn("credentials", { redirect: false })`
 *    do Auth.js v5. Com `redirect: false`, o cookie de sessão é gravado
 *    sem que o servidor dispare um redirect HTTP — assim conseguimos
 *    fazer `router.push(next)` no cliente preservando o destino vindo
 *    de `?next=` (R1.4).
 * 3. Em caso de falha (`ActionResult.ok === false`), exibe a mensagem
 *    genérica devolvida pelo servidor logo abaixo do formulário. A
 *    mensagem é deliberadamente igual para "email não existe", "senha
 *    errada" e "usuário inativo" para evitar enumeração de contas
 *    (R1.3 / R1.5).
 * 4. Em caso de sucesso, chama `router.push(next)` e força um
 *    `router.refresh()` para que os Server Components recém-acessados
 *    reavaliem `auth()` com o cookie novo.
 *
 * Acessibilidade:
 *   - Labels associadas aos inputs por `htmlFor`/`id`.
 *   - Erros de validação por campo via `aria-describedby` apontando
 *     para o `<p>` de erro correspondente.
 *   - Erro global do servidor sob `role="alert"` para anúncio por
 *     leitores de tela.
 *
 * Validates: R1.1, R1.3, R1.4, R1.5, R20.1.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { loginAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/error-messages";

/**
 * Schema do formulário. As mensagens são em pt-BR (R20.1) e são as
 * únicas mensagens específicas exibidas — qualquer falha que dependa
 * do estado do banco (email inexistente, senha errada, usuário
 * inativo) recai sobre a mensagem genérica devolvida pelo servidor.
 */
const LoginSchema = z.object({
    email: z
        .string()
        .min(1, "Informe seu e-mail.")
        .email("E-mail inválido."),
    password: z.string().min(1, "Informe sua senha."),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

export interface LoginFormProps {
    /**
     * Caminho interno (já saneado pela página) para onde redirecionar
     * após login bem-sucedido. Defaults para `/dashboard`.
     */
    next: string;
}

export function LoginForm({ next }: LoginFormProps) {
    const router = useRouter();

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(LoginSchema),
        defaultValues: { email: "", password: "" },
    });

    const [serverError, setServerError] = React.useState<string | null>(null);

    async function onSubmit(values: LoginFormValues): Promise<void> {
        setServerError(null);
        const result = await loginAction({
            email: values.email,
            password: values.password,
        });
        if (!result.ok) {
            setServerError(getErrorMessage(result.error));
            return;
        }
        router.push(next);
        router.refresh();
    }

    return (
        <form
            noValidate
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
        >
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="login-email"
                    className="text-sm font-medium text-(--ink)"
                >
                    E-mail
                </label>
                <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    error={Boolean(errors.email)}
                    aria-describedby={
                        errors.email ? "login-email-error" : undefined
                    }
                    {...register("email")}
                />
                {errors.email ? (
                    <p
                        id="login-email-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.email.message}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="login-password"
                    className="text-sm font-medium text-(--ink)"
                >
                    Senha
                </label>
                <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    error={Boolean(errors.password)}
                    aria-describedby={
                        errors.password ? "login-password-error" : undefined
                    }
                    {...register("password")}
                />
                {errors.password ? (
                    <p
                        id="login-password-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.password.message}
                    </p>
                ) : null}
            </div>

            {serverError ? (
                <p
                    role="alert"
                    className="rounded-(--r-2) border border-(--red) bg-(--red-soft) px-3 py-2 text-xs text-(--red)"
                >
                    {serverError}
                </p>
            ) : null}

            <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={isSubmitting}
                className="w-full"
            >
                Entrar
            </Button>
        </form>
    );
}
