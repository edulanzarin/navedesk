/**
 * `DeleteArticleButton` — Client Component que dispara a action
 * `deleteArticleAction` com confirmação nativa do navegador.
 *
 * Mantemos a confirmação via `window.confirm` por enquanto: o app
 * ainda não tem um primitivo `<ConfirmDialog />`, e a operação é rara
 * o bastante para que o diálogo nativo seja aceitável. Quando um
 * `ConfirmDialog` for criado, basta substituir o `window.confirm`
 * pelo componente sem alterar a API deste botão.
 *
 * Após sucesso, redireciona para `/kb` — o detalhe do slug deletado
 * passaria a responder 404, mantê-lo aberto seria pior que voltar.
 *
 * Validates: R13.
 */

"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Trash2 } from "lucide-react";

import { deleteArticleAction } from "@/actions/kb";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-messages";

export interface DeleteArticleButtonProps {
    /** Slug do artigo a ser excluído. */
    slug: string;
    /** Título exibido no diálogo de confirmação para reduzir erros. */
    title: string;
}

export function DeleteArticleButton({
    slug,
    title,
}: DeleteArticleButtonProps): React.ReactElement {
    const router = useRouter();
    const [isPending, startTransition] = React.useTransition();

    function handleClick(): void {
        const confirmed = window.confirm(
            `Excluir o artigo "${title}"? Essa ação não pode ser desfeita.`,
        );
        if (!confirmed) return;

        startTransition(async () => {
            const result = await deleteArticleAction(slug);
            if (result.ok) {
                toast({
                    variant: "success",
                    title: "Artigo excluído",
                });
                router.push("/kb");
                return;
            }
            toast({
                variant: "error",
                title: "Não foi possível excluir o artigo",
                description: getErrorMessage(result.error),
            });
        });
    }

    return (
        <Button
            variant="danger"
            icon={<Trash2 />}
            onClick={handleClick}
            loading={isPending}
            disabled={isPending}
        >
            Excluir
        </Button>
    );
}
