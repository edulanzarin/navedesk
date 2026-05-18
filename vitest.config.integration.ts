import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(rootDir, "src"),
        },
    },
    test: {
        environment: "node",
        globals: true,
        include: ["tests/integration/**/*.{test,spec}.{ts,tsx}"],
        exclude: ["node_modules/**", ".next/**"],
        // Testcontainers can take a while to pull images and boot containers.
        testTimeout: 60_000,
        hookTimeout: 60_000,
        // Containers are heavy; run tests sequentially to avoid resource
        // contention and flaky port allocation.
        pool: "forks",
        fileParallelism: false,
        maxWorkers: 1,
    },
});
