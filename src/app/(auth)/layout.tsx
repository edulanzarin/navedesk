/**
 * Layout do grupo de rotas `(auth)`.
 *
 * Conteúdo das telas anônimas (apenas `/login` por enquanto). Aplica um
 * wallpaper colorido com gradientes radiais (índigo/azul/rosa) sobre o
 * qual o card de login flutua em vidro intenso (Liquid Glass), no
 * estilo macOS Tahoe.
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
        <main
            className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
            style={{
                background:
                    "radial-gradient(900px 600px at 20% 10%, rgba(94, 92, 230, 0.18), transparent 60%), radial-gradient(800px 500px at 90% 90%, rgba(20, 115, 230, 0.12), transparent 55%), radial-gradient(400px 300px at 70% 20%, rgba(255, 107, 167, 0.1), transparent 60%), #ececef",
            }}
        >
            {/* Camada decorativa: blobs sutis adicionais para dar profundidade. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                    background:
                        "radial-gradient(600px 400px at 50% 50%, rgba(255, 255, 255, 0.4), transparent 60%)",
                }}
            />
            {children}
        </main>
    );
}
