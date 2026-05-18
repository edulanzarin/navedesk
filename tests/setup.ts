import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Garante DOM limpo entre testes para evitar vazamento de estado entre specs.
afterEach(() => {
    cleanup();
});
