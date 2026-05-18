import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(rootDir, "src"),
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./tests/setup.ts"],
        include: [
            "tests/unit/**/*.{test,spec}.{ts,tsx}",
            "tests/pbt/**/*.{test,spec}.{ts,tsx}",
            "src/**/*.{test,spec}.{ts,tsx}",
        ],
        exclude: ["node_modules/**", ".next/**", "tests/integration/**", "tests/e2e/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            include: [
                "src/lib/**/*.{ts,tsx}",
                "src/services/**/*.{ts,tsx}",
                "src/db/repositories/**/*.{ts,tsx}",
            ],
            exclude: ["**/*.d.ts", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
    },
});
