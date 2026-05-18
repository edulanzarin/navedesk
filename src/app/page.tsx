/**
 * Página raiz `/` (Server Component).
 *
 * Atua como roteador para o ponto de entrada correto do aplicativo:
 * usuários autenticados vão direto para `/dashboard`; visitantes
 * anônimos são enviados a `/login`. Não renderiza UI própria — o
 * conteúdo "real" da home do produto é o dashboard.
 *
 * Por que aqui e não no middleware?
 *
 * - O `matcher` do middleware exclui rotas externas ao grupo `(app)`,
 *   então `/` passa direto. Em vez de inflá-lo com mais um caso
 *   especial, o redirect fica no Server Component da própria página,
 *   que é o lugar mais natural quando o critério é apenas "tem
 *   sessão?".
 * - Mantém a lógica de roteamento autenticado co-localizada com as
 *   demais páginas autenticadas (todas chamam `auth()` no topo).
 *
 * Validates: R1.1, R1.7.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export default async function Home() {
    const session = await auth();
    if (session?.user) {
        redirect("/dashboard");
    }
    redirect("/login");
}
