/**
 * Primitivo `Avatar`.
 *
 * Círculo com iniciais (primeira letra do primeiro e do último nome,
 * em maiúsculas) ou imagem opcional. A cor de fundo é derivada do
 * campo `avatarColor` armazenado em `users.avatar_color` (espelhado em
 * `User.avatarColor`); por padrão usa o token `--accent`. O texto é
 * sempre branco para garantir contraste suficiente sobre as cores
 * hexadecimais geradas pelo seed/perfil.
 *
 * Quando `src` é informado, renderiza `<img>` com fallback automático
 * para as iniciais caso a imagem falhe ao carregar (`onError`). Como o
 * fallback depende de estado, o componente roda como Client Component.
 *
 * Usado por `Topbar`, `TicketConversation` (avatar do autor da
 * mensagem), tabela de usuários do admin e página de perfil.
 *
 * Validates: R19.3
 */

"use client";

import * as React from "react";

import Image from "next/image";

import { cn } from "@/lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps
    extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
    /** Nome completo do usuário; usado para derivar as iniciais. */
    name: string;
    /** Cor de fundo em hexadecimal (ex.: `#5E5CE6`). Default: `--accent`. */
    color?: string;
    /** Tamanho do avatar. Default: `md`. */
    size?: AvatarSize;
    /** URL opcional da imagem; em caso de erro cai para iniciais. */
    src?: string;
    /** Classes adicionais aplicadas ao wrapper. */
    className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
    sm: "h-6 w-6 text-xs",
    md: "h-8 w-8 text-sm",
    lg: "h-10 w-10 text-base",
};

/**
 * Extrai as iniciais usando a primeira letra da primeira e da última
 * palavra do nome. Nomes com uma única palavra retornam apenas uma
 * letra. Strings vazias ou só com espaços retornam `?`.
 */
function getInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const firstWord = words[0]!;
    const first = firstWord.charAt(0);
    if (words.length === 1) return first.toUpperCase();
    const lastWord = words[words.length - 1]!;
    const last = lastWord.charAt(0);
    return `${first}${last}`.toUpperCase();
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
    function Avatar(
        { name, color, size = "md", src, className, ...props },
        ref,
    ) {
        const [imageFailed, setImageFailed] = React.useState(false);

        // Reseta o estado de erro quando o consumidor troca a imagem.
        React.useEffect(() => {
            setImageFailed(false);
        }, [src]);

        const initials = getInitials(name);
        const showImage = Boolean(src) && !imageFailed;
        const background = color ?? "var(--accent)";

        return (
            <span
                ref={ref}
                role="img"
                aria-label={name}
                className={cn(
                    "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium text-white",
                    sizeClasses[size],
                    className,
                )}
                style={{ backgroundColor: background }}
                {...props}
            >
                {showImage ? (
                    <Image
                        src={src!}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                        onError={() => setImageFailed(true)}
                        unoptimized
                    />
                ) : (
                    <span aria-hidden="true">{initials}</span>
                )}
            </span>
        );
    },
);
