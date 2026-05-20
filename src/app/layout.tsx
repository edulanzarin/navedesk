import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { Toaster } from "@/components/ui/toaster";
import { BRAND_DESCRIPTION, BRAND_NAME, LOGO_PATH } from "@/lib/brand";

import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
    title: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    icons: {
        // Usa o mesmo PNG do logo como favicon. Next gera os links
        // `<link rel="icon">` automaticamente a partir desse mapa.
        icon: LOGO_PATH,
        shortcut: LOGO_PATH,
        apple: LOGO_PATH,
    },
    manifest: "/manifest.json",
    themeColor: "#5E5CE6",
    appleWebApp: {
        capable: true,
        statusBarStyle: "default",
        title: BRAND_NAME,
    },
};

/**
 * Layout raiz do NaveDesk.
 *
 * - `lang="pt-BR"` cumpre R20.2 (idioma do produto).
 * - Geist Sans/Mono são carregados via `next/font` (pacote oficial
 *   `geist` da Vercel), expondo as variáveis `--font-geist-sans` e
 *   `--font-geist-mono` que `tokens.css` referencia em `--font` e
 *   `--font-mono` (R21.2, R21.3).
 * - `<Toaster />` monta `ToastProvider` + `ToastViewport` em um único
 *   ponto, atendendo ao requisito de provider global de toasts
 *   (R19.3, R22) usado por feedback de Server Actions e uploads.
 *
 * Validates: R20.2, R21.2, R21.3, R19.3, R22
 */
export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="pt-BR"
            className={`${GeistSans.variable} ${GeistMono.variable}`}
        >
            <head>
                <meta name="mobile-web-app-capable" content="yes" />
            </head>
            <body>
                {children}
                <Toaster />
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            if ('serviceWorker' in navigator) {
                                window.addEventListener('load', () => {
                                    navigator.serviceWorker.register('/sw.js');
                                });
                            }
                        `,
                    }}
                />
            </body>
        </html>
    );
}
