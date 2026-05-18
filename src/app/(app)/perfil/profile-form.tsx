/**
 * `ProfileForm` — Client Component que renderiza os dados pessoais e o
 * formulário de troca de senha da página `/perfil` (R1.6).
 *
 * Layout:
 *
 * - Dois `Card`s lado a lado em viewports largos, empilhados em telas
 *   estreitas. O primeiro mostra os dados de identidade (nome, email,
 *   papel, departamento, cor de avatar) — todos somente leitura, já
 *   que o domínio atual não expõe edição desses campos pelo próprio
 *   usuário (alterações de papel/departamento são responsabilidade do
 *   admin em `/admin/usuarios`, R14).
 * - O segundo card abriga o formulário de troca de senha com três
 *   campos (`currentPassword`, `newPassword`, `confirmPassword`) e um
 *   botão `Atualizar senha`.
 *
 * Comportamento:
 *
 * 1. O estado local guarda os três campos do formulário e um conjunto
 *    de erros por campo. O submit dispara `changePasswordAction` via
 *    `useTransition` para que o botão entre em `loading` enquanto a
 *    Server Action está em voo.
 * 2. Em sucesso, limpa o formulário e mostra um toast positivo. A
 *    sessão atual continua válida — não desligamos o usuário aqui
 *    (R1.6 não exige reautenticação após troca de senha).
 * 3. Em erro, mostra um toast com a mensagem do `ActionResult.error`.
 *    Quando o servidor retorna um `field` (ex.: `currentPassword`,
 *    `newPassword`, `confirmPassword`), aplicamos o estado de erro no
 *    `Input` correspondente para guiar o usuário. Validações simples
 *    no cliente (campos não vazios, confirmação igual à nova senha)
 *    poupam round-trips óbvios sem reimplementar o schema completo —
 *    a borda continua sendo a fonte da verdade.
 *
 * Validates: R1.6.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Camera, Trash2 } from "lucide-react";

import { changePasswordAction } from "@/actions/auth";
import { updateAvatarAction } from "@/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { ROLE_LABELS_PT } from "@/lib/constants";
import { getErrorMessage } from "@/lib/error-messages";
import type { Role } from "@/types/domain";

export interface ProfileFormProps {
    /** Nome completo do usuário autenticado. */
    name: string;
    /** E-mail (login) do usuário autenticado. */
    email: string;
    /** Papel RBAC do usuário (`solicitante` | `tecnico` | `admin`). */
    role: Role;
    /** Nome do departamento, ou `null` quando não há. */
    departmentName: string | null;
    /** Cor de avatar persistida em `users.avatar_color` (`#RRGGBB`). */
    avatarColor: string;
    /** URL da foto de perfil, ou `null` quando o usuário usa só iniciais. */
    avatarUrl: string | null;
}

/**
 * Paleta fixa de cores oferecidas para o avatar de iniciais. Os tokens
 * de UI já têm uma família de cores temáticas (índigo, azul, verde,
 * âmbar, vermelho, índigo claro, cinza escuro, ardósia); espelhamos
 * aqui em hexadecimais correspondentes para que o seletor mostre
 * círculos sólidos coerentes com a paleta do produto. O usuário não
 * pode digitar uma cor arbitrária — a borda do servidor valida o
 * formato `#RRGGBB`, mas mantermos uma paleta curta facilita a UX e
 * evita combinações com baixo contraste sobre o texto branco.
 */
const AVATAR_PALETTE: ReadonlyArray<{ name: string; value: string }> = [
    { name: "Índigo", value: "#5E5CE6" },
    { name: "Azul", value: "#1473E6" },
    { name: "Verde", value: "#30B257" },
    { name: "Âmbar", value: "#D98C00" },
    { name: "Vermelho", value: "#E0342B" },
    { name: "Rosa", value: "#D63384" },
    { name: "Roxo", value: "#7D3CFF" },
    { name: "Ardósia", value: "#475569" },
];

interface PasswordFormState {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}

const EMPTY_FORM: PasswordFormState = {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
};

/** Campos do formulário que podem receber erro vindo do servidor. */
type PasswordField = keyof PasswordFormState;

/** Mapa rápido de tom para cada papel — espelha `users-management`. */
const ROLE_BADGE_TONE: Record<Role, "indigo" | "blue" | "grey"> = {
    admin: "indigo",
    tecnico: "blue",
    solicitante: "grey",
};

export function ProfileForm({
    name,
    email,
    role,
    departmentName,
    avatarColor,
    avatarUrl,
}: ProfileFormProps): React.ReactElement {
    const [form, setForm] = React.useState<PasswordFormState>(EMPTY_FORM);
    const [errorField, setErrorField] = React.useState<PasswordField | null>(
        null,
    );
    const [isPending, startTransition] = React.useTransition();

    /**
     * Estado local do avatar — sincronizado com as props no primeiro
     * render. Updates otimistas: ao trocar a cor ou enviar uma foto,
     * a UI reflete imediatamente e a Server Action persiste em
     * background. Em caso de erro, revertemos para a versão anterior.
     */
    const [color, setColor] = React.useState(avatarColor);
    const [photoUrl, setPhotoUrl] = React.useState<string | null>(avatarUrl);
    const [avatarPending, setAvatarPending] = React.useState<
        false | "color" | "upload" | "remove"
    >(false);
    const router = useRouter();

    /**
     * Ref do `<input type="file">` oculto. O botão "Alterar foto"
     * dispara um `click()` programático nele.
     */
    const photoInputRef = React.useRef<HTMLInputElement | null>(null);

    function updateField(field: PasswordField, value: string): void {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (errorField === field) {
            // O usuário começou a corrigir o campo problemático; remove
            // o highlight de erro para manter o feedback honesto.
            setErrorField(null);
        }
    }

    /**
     * Aplica uma nova cor de avatar otimisticamente: a UI reflete na
     * hora, e a Server Action persiste em background. Em caso de
     * erro, revertemos para a cor anterior e mostramos um toast.
     */
    async function handleSelectColor(next: string): Promise<void> {
        if (next === color) return;
        const previous = color;
        setColor(next);
        setAvatarPending("color");
        try {
            const result = await updateAvatarAction({ color: next });
            if (!result.ok) {
                setColor(previous);
                toast({
                    variant: "error",
                    title: "Não foi possível alterar a cor",
                    description: getErrorMessage(result.error),
                });
                return;
            }
            // Re-renderiza ancestrais (Sidebar/Topbar) que leem
            // `auth().user.avatarColor` no Server Component.
            router.refresh();
        } finally {
            setAvatarPending(false);
        }
    }

    /**
     * Faz upload de uma nova foto de perfil via `POST /api/uploads`
     * (mesma rota usada por anexos de tickets — RBAC e magic bytes
     * já validados lá), depois grava a URL retornada em
     * `users.avatar_url` via `updateAvatarAction`. O input de
     * arquivo é zerado depois de cada submit para permitir o usuário
     * reescolher o mesmo arquivo (o `change` event não dispara para
     * o mesmo nome).
     */
    async function handlePhotoSelected(
        e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        setAvatarPending("upload");
        try {
            // Upload no `/api/uploads` — mesmo handler dos anexos de
            // tickets/KB, com validação de tipo, magic bytes e tamanho.
            const fd = new FormData();
            fd.append("file", file);
            const uploadRes = await fetch("/api/uploads", {
                method: "POST",
                body: fd,
            });
            if (!uploadRes.ok) {
                const data = (await uploadRes.json().catch(() => null)) as
                    | { code?: string; message?: string }
                    | null;
                toast({
                    variant: "error",
                    title: "Falha no upload",
                    description:
                        data?.message ??
                        "Não foi possível enviar a foto.",
                });
                return;
            }
            const uploaded = (await uploadRes.json()) as {
                id: string;
                url: string;
            };

            // Persiste a URL em `users.avatar_url`.
            const previous = photoUrl;
            setPhotoUrl(uploaded.url);
            const result = await updateAvatarAction({
                avatarUrl: uploaded.url,
            });
            if (!result.ok) {
                setPhotoUrl(previous);
                toast({
                    variant: "error",
                    title: "Não foi possível salvar a foto",
                    description: getErrorMessage(result.error),
                });
                return;
            }
            toast({
                variant: "success",
                title: "Foto atualizada",
                description: file.name,
            });
            router.refresh();
        } finally {
            setAvatarPending(false);
        }
    }

    /**
     * Remove a foto de perfil — o avatar volta às iniciais sobre a
     * cor selecionada. Não apaga o arquivo no storage; apenas
     * desliga a referência. Em uma evolução futura, podemos
     * orfanizar uploads não referenciados.
     */
    async function handleRemovePhoto(): Promise<void> {
        if (photoUrl === null) return;
        const previous = photoUrl;
        setPhotoUrl(null);
        setAvatarPending("remove");
        try {
            const result = await updateAvatarAction({ avatarUrl: null });
            if (!result.ok) {
                setPhotoUrl(previous);
                toast({
                    variant: "error",
                    title: "Não foi possível remover a foto",
                    description: getErrorMessage(result.error),
                });
                return;
            }
            toast({
                variant: "success",
                title: "Foto removida",
            });
            router.refresh();
        } finally {
            setAvatarPending(false);
        }
    }

    /**
     * Pré-validação client-side: evita disparar Server Action quando
     * algum campo essencial está vazio ou a confirmação difere. Não
     * reimplementa todas as regras (tamanho mínimo, senha igual à
     * atual) — essas continuam no servidor via `ChangePasswordSchema`.
     */
    function preValidate(): PasswordField | null {
        if (form.currentPassword.length === 0) return "currentPassword";
        if (form.newPassword.length === 0) return "newPassword";
        if (form.confirmPassword.length === 0) return "confirmPassword";
        if (form.newPassword !== form.confirmPassword) return "confirmPassword";
        return null;
    }

    function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
        e.preventDefault();
        const localError = preValidate();
        if (localError) {
            setErrorField(localError);
            toast({
                variant: "error",
                title: "Verifique os campos",
                description:
                    localError === "confirmPassword"
                        ? "A confirmação não corresponde à nova senha."
                        : "Preencha todos os campos para continuar.",
            });
            return;
        }

        startTransition(async () => {
            const result = await changePasswordAction({
                currentPassword: form.currentPassword,
                newPassword: form.newPassword,
                confirmPassword: form.confirmPassword,
            });
            if (result.ok) {
                setForm(EMPTY_FORM);
                setErrorField(null);
                toast({
                    variant: "success",
                    title: "Senha atualizada",
                    description:
                        "Use a nova senha no próximo login. Sua sessão atual continua válida.",
                });
            } else {
                const field = result.error.field as PasswordField | undefined;
                if (
                    field === "currentPassword" ||
                    field === "newPassword" ||
                    field === "confirmPassword"
                ) {
                    setErrorField(field);
                }
                toast({
                    variant: "error",
                    title: "Não foi possível atualizar a senha",
                    description: getErrorMessage(result.error),
                });
            }
        });
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>Dados pessoais</CardTitle>
                    <CardDescription>
                        Personalize seu avatar e visualize as informações
                        gerenciadas pelo administrador do Navedesk.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-6">
                        {/* Avatar atual + botões de foto. O input
                            file fica oculto e é disparado pelo botão
                            "Alterar foto". */}
                        <div className="flex flex-wrap items-center gap-4">
                            <Avatar
                                name={name}
                                color={color}
                                size="lg"
                                {...(photoUrl ? { src: photoUrl } : {})}
                                className="size-16 text-xl"
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p className="truncate font-medium text-(--ink)">
                                    {name}
                                </p>
                                <p className="truncate text-sm text-(--ink-3)">
                                    {email}
                                </p>
                            </div>
                            <input
                                ref={photoInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                className="hidden"
                                onChange={handlePhotoSelected}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    icon={<Camera />}
                                    loading={avatarPending === "upload"}
                                    disabled={avatarPending !== false}
                                    onClick={() =>
                                        photoInputRef.current?.click()
                                    }
                                >
                                    {photoUrl
                                        ? "Trocar foto"
                                        : "Enviar foto"}
                                </Button>
                                {photoUrl ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        icon={<Trash2 />}
                                        loading={avatarPending === "remove"}
                                        disabled={avatarPending !== false}
                                        onClick={() => {
                                            void handleRemovePhoto();
                                        }}
                                    >
                                        Remover
                                    </Button>
                                ) : null}
                            </div>
                        </div>

                        {/* Paleta de cores. A cor só aparece "atrás"
                            das iniciais quando o usuário não tem foto,
                            mas o seletor fica disponível em ambos os
                            casos — o usuário pode preparar a cor antes
                            de remover a foto. */}
                        <div className="flex flex-col gap-2">
                            <label className="text-xs uppercase tracking-wide text-(--ink-3)">
                                Cor do avatar
                            </label>
                            <div
                                role="radiogroup"
                                aria-label="Cor do avatar"
                                className="flex flex-wrap items-center gap-2"
                            >
                                {AVATAR_PALETTE.map((swatch) => {
                                    const selected = color === swatch.value;
                                    return (
                                        <button
                                            key={swatch.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            aria-label={`Cor ${swatch.name}`}
                                            disabled={avatarPending !== false}
                                            onClick={() => {
                                                void handleSelectColor(
                                                    swatch.value,
                                                );
                                            }}
                                            className={[
                                                "relative size-8 rounded-full outline-none transition-transform",
                                                "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)",
                                                "disabled:cursor-not-allowed disabled:opacity-50",
                                                selected
                                                    ? "ring-2 ring-offset-2 ring-(--ink) ring-offset-(--bg-elev)"
                                                    : "hover:scale-110",
                                            ].join(" ")}
                                            style={{
                                                backgroundColor: swatch.value,
                                            }}
                                        />
                                    );
                                })}
                            </div>
                            <p className="text-xs text-(--ink-3)">
                                Aparece atrás das suas iniciais quando você
                                não tem foto de perfil.
                            </p>
                        </div>

                        <dl className="grid gap-3 border-t border-(--line) pt-4 text-sm">
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-(--ink-3)">Papel</dt>
                                <dd>
                                    <Badge tone={ROLE_BADGE_TONE[role]}>
                                        {ROLE_LABELS_PT[role]}
                                    </Badge>
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-(--ink-3)">Departamento</dt>
                                <dd className="text-(--ink)">
                                    {departmentName ?? "—"}
                                </dd>
                            </div>
                        </dl>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Trocar senha</CardTitle>
                    <CardDescription>
                        Para alterar sua senha, informe a senha atual e
                        defina uma nova com pelo menos 8 caracteres.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-4"
                        noValidate
                    >
                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="profile-current-password"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Senha atual
                            </label>
                            <Input
                                id="profile-current-password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={form.currentPassword}
                                error={errorField === "currentPassword"}
                                onChange={(e) =>
                                    updateField(
                                        "currentPassword",
                                        e.target.value,
                                    )
                                }
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="profile-new-password"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Nova senha
                            </label>
                            <Input
                                id="profile-new-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={8}
                                maxLength={128}
                                value={form.newPassword}
                                error={errorField === "newPassword"}
                                aria-describedby="profile-new-password-hint"
                                onChange={(e) =>
                                    updateField(
                                        "newPassword",
                                        e.target.value,
                                    )
                                }
                            />
                            <p
                                id="profile-new-password-hint"
                                className="text-xs text-(--ink-3)"
                            >
                                Mínimo 8 caracteres. Use uma senha única,
                                não compartilhada com outros sistemas.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="profile-confirm-password"
                                className="text-sm font-medium text-(--ink)"
                            >
                                Confirmar nova senha
                            </label>
                            <Input
                                id="profile-confirm-password"
                                type="password"
                                autoComplete="new-password"
                                required
                                minLength={8}
                                maxLength={128}
                                value={form.confirmPassword}
                                error={errorField === "confirmPassword"}
                                onChange={(e) =>
                                    updateField(
                                        "confirmPassword",
                                        e.target.value,
                                    )
                                }
                            />
                        </div>

                        <div className="flex justify-end">
                            <Button
                                type="submit"
                                variant="primary"
                                loading={isPending}
                            >
                                Atualizar senha
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
