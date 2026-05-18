import type { Config } from "tailwindcss";

// Tailwind v4 lê a maior parte da configuração diretamente do CSS via
// `@theme`. Este arquivo registra explicitamente as fontes de conteúdo
// a serem escaneadas (src/**/*.ts e .tsx) e mantém um ponto único
// caso seja necessário declarar presets/plugins futuros. A paleta
// índigo Tahoe, raios e sombras virão das tasks 4.x via tokens CSS.
const config: Config = {
    content: ["./src/**/*.{ts,tsx}"],
};

export default config;
