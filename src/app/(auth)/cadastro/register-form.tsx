/**
 * `RegisterForm` — formulário de auto-cadastro em `/cadastro`.
 *
 * Client Component porque combina `react-hook-form` + `zodResolver` para
 * validação no cliente (UX rápida, sem ida ao servidor) e dispara o
 * `useRouter().push("/dashboard")` ao concluir.
 *
 * Fluxo:
 *
 * 1. Valida `name`, `email`, `departmentId`, `password` e
 *    `confirmPassword` via Zod antes de submeter.
 * 2. Chama `registerAction(values)`. A action aplica rate limit (5/h
 *    por IP), cria a conta como `solicitante` e tenta auto-login.
 * 3. Em sucesso, redireciona para `/dashboard` e força refresh para
 *    que Server Components reavaliem a sessão.
 * 4. Em falha de validação/conflito, marca o campo correspondente.
 *    Outros erros caem na mensagem genérica do servidor.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { registerAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/lib/error-messages";

interface DepartmentOption {
    id: string;
    name: string;
}

const RegisterSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(2, "Informe seu nome completo.")
            .max(120, "Nome muito longo."),
        email: z
            .string()
            .min(1, "Informe seu e-mail.")
            .email("E-mail inválido."),
        departmentId: z.string().uuid("Selecione um departamento."),
        password: z
            .string()
            .min(8, "A senha precisa ter ao menos 8 caracteres.")
            .max(128, "Senha muito longa."),
        confirmPassword: z.string().min(1, "Confirme sua senha."),
    })
    .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["confirmPassword"],
                message: "A confirmação não corresponde à senha.",
            });
        }
    });

type RegisterFormValues = z.infer<typeof RegisterSchema>;

export interface RegisterFormProps {
    departments: DepartmentOption[];
}

export function RegisterForm({ departments }: RegisterFormProps) {
    const router = useRouter();

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<RegisterFormValues>({
        resolver: zodResolver(RegisterSchema),
        defaultValues: {
            name: "",
            email: "",
            departmentId: "",
            password: "",
            confirmPassword: "",
        },
    });

    // O Radix Select não casa com `register()` porque não dispara
    // eventos nativos de input — gerenciamos via `watch`/`setValue`.
    const departmentId = watch("departmentId");

    const [serverError, setServerError] = React.useState<string | null>(null);

    async function onSubmit(values: RegisterFormValues): Promise<void> {
        setServerError(null);
        const result = await registerAction(values);
        if (!result.ok) {
            // Marca o campo específico quando o erro é localizado.
            if (result.error.field === "email") {
                setError("email", {
                    type: "server",
                    message: result.error.message,
                });
                return;
            }
            setServerError(getErrorMessage(result.error));
            return;
        }
        router.push("/dashboard");
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
                    htmlFor="register-name"
                    className="text-sm font-medium text-(--ink)"
                >
                    Nome completo
                </label>
                <Input
                    id="register-name"
                    type="text"
                    autoComplete="name"
                    error={Boolean(errors.name)}
                    aria-describedby={
                        errors.name ? "register-name-error" : undefined
                    }
                    {...register("name")}
                />
                {errors.name ? (
                    <p
                        id="register-name-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.name.message}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="register-email"
                    className="text-sm font-medium text-(--ink)"
                >
                    E-mail
                </label>
                <Input
                    id="register-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    error={Boolean(errors.email)}
                    aria-describedby={
                        errors.email ? "register-email-error" : undefined
                    }
                    {...register("email")}
                />
                {errors.email ? (
                    <p
                        id="register-email-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.email.message}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="register-department"
                    className="text-sm font-medium text-(--ink)"
                >
                    Departamento
                </label>
                <Select
                    value={departmentId}
                    onValueChange={(value) => setValue("departmentId", value)}
                >
                    <SelectTrigger
                        id="register-department"
                        aria-invalid={Boolean(errors.departmentId)}
                    >
                        <SelectValue placeholder="Selecione seu departamento" />
                    </SelectTrigger>
                    <SelectContent>
                        {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                                {d.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {errors.departmentId ? (
                    <p className="text-xs text-(--red)">
                        {errors.departmentId.message}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="register-password"
                    className="text-sm font-medium text-(--ink)"
                >
                    Senha
                </label>
                <Input
                    id="register-password"
                    type="password"
                    autoComplete="new-password"
                    error={Boolean(errors.password)}
                    aria-describedby={
                        errors.password ? "register-password-error" : undefined
                    }
                    {...register("password")}
                />
                {errors.password ? (
                    <p
                        id="register-password-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.password.message}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="register-confirm"
                    className="text-sm font-medium text-(--ink)"
                >
                    Confirmar senha
                </label>
                <Input
                    id="register-confirm"
                    type="password"
                    autoComplete="new-password"
                    error={Boolean(errors.confirmPassword)}
                    aria-describedby={
                        errors.confirmPassword
                            ? "register-confirm-error"
                            : undefined
                    }
                    {...register("confirmPassword")}
                />
                {errors.confirmPassword ? (
                    <p
                        id="register-confirm-error"
                        className="text-xs text-(--red)"
                    >
                        {errors.confirmPassword.message}
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
                Criar conta
            </Button>
        </form>
    );
}
