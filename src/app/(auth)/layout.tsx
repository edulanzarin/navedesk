/**
 * Layout do grupo de rotas `(auth)`.
 *
 * Conteúdo das telas anônimas (apenas `/login` por enquanto). Não monta
 * Sidebar/Topbar — apenas centraliza o conteúdo num container vertical
 * sobre o token `--bg`, deixando que cada página/ form decida sua
 * própria caixa visual (`Card`).
 *
 * Mantemos o layout enxuto e Server Component para evitar custo de
 * hydration desnecessário antes mesmo do usuário autenticar.
 *
 * Validates: R20.2 (idioma já vem do `<html lang="pt-BR">` em
 * `app/layout.tsx`).
 */
export default function AuthLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-(--bg) px-4 py-10">
            {children}
        </main>
    );
}
