/**
 * PostCSS config para Tailwind v4. Em Next.js 15 a convenção é usar
 * `postcss.config.mjs` (não TS). O plugin `@tailwindcss/postcss` substitui
 * o antigo `tailwindcss` + `autoprefixer` da v3.
 */
const config = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};

export default config;
