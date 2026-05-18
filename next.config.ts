import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    // Em produção, queremos que o build do Docker/CI conclua mesmo se o
    // ESLint reclamar de ordem de imports e regras estéticas. O lint
    // continua disponível em dev e via `pnpm lint` na pipeline local —
    // bloqueá-lo aqui interrompe deploys por motivos não-funcionais.
    eslint: {
        ignoreDuringBuilds: true,
    },
};

export default nextConfig;
