/**
 * Testes unitários para os schemas Zod compartilhados.
 *
 * Validates: R3.2, R7.1
 */

import { describe, it, expect } from "vitest";

import {
    CreateTicketSchema,
    UpdateTicketSchema,
    PostMessageSchema,
    CreateUserSchema,
    UpdateSlaPolicySchema,
    CreateCategorySchema,
    CreateKbArticleSchema,
    UploadConstraints,
} from "@/lib/schemas";

const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const repeat = (ch: string, n: number): string => ch.repeat(n);

describe("CreateTicketSchema", () => {
    const baseValid = {
        title: "Erro ao acessar o sistema",
        description: "Não consigo entrar com minhas credenciais habituais.",
        categoryId: "acesso",
        priority: "media" as const,
        departmentId: UUID_A,
        attachments: [UUID_B],
    };

    it("aceita um payload completo válido", () => {
        const result = CreateTicketSchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    it("rejeita quando o título está ausente", () => {
        const { title: _omit, ...rest } = baseValid;
        const result = CreateTicketSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejeita título com menos de 5 caracteres (após trim)", () => {
        const result = CreateTicketSchema.safeParse({ ...baseValid, title: "abc" });
        expect(result.success).toBe(false);
    });

    it("rejeita título cujo conteúdo após trim fica menor que 5 (apenas espaços)", () => {
        const result = CreateTicketSchema.safeParse({ ...baseValid, title: "   " });
        expect(result.success).toBe(false);
    });

    it("aceita título exatamente no limite mínimo (5 caracteres)", () => {
        const result = CreateTicketSchema.safeParse({ ...baseValid, title: "abcde" });
        expect(result.success).toBe(true);
    });

    it("aceita título exatamente no limite máximo (120 caracteres)", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            title: repeat("a", 120),
        });
        expect(result.success).toBe(true);
    });

    it("rejeita título com mais de 120 caracteres", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            title: repeat("a", 121),
        });
        expect(result.success).toBe(false);
    });

    it("rejeita descrição com menos de 10 caracteres", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            description: "curta",
        });
        expect(result.success).toBe(false);
    });

    it("aceita descrição exatamente no limite mínimo (10 caracteres)", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            description: repeat("a", 10),
        });
        expect(result.success).toBe(true);
    });

    it("aceita descrição exatamente no limite máximo (2000 caracteres)", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            description: repeat("a", 2000),
        });
        expect(result.success).toBe(true);
    });

    it("rejeita descrição com mais de 2000 caracteres", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            description: repeat("a", 2001),
        });
        expect(result.success).toBe(false);
    });

    it("rejeita prioridade fora do enum", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            priority: "urgente",
        });
        expect(result.success).toBe(false);
    });

    it("aceita todas as prioridades válidas", () => {
        for (const priority of ["baixa", "media", "alta", "critica"] as const) {
            const result = CreateTicketSchema.safeParse({ ...baseValid, priority });
            expect(result.success).toBe(true);
        }
    });

    it("rejeita departmentId que não é um UUID", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            departmentId: "nao-uuid",
        });
        expect(result.success).toBe(false);
    });

    it("rejeita categoryId vazio", () => {
        const result = CreateTicketSchema.safeParse({ ...baseValid, categoryId: "" });
        expect(result.success).toBe(false);
    });

    it("rejeita tipos errados (campos numéricos no lugar de strings)", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            title: 123 as unknown as string,
        });
        expect(result.success).toBe(false);
    });

    it("rejeita anexo cujo elemento não é UUID", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            attachments: ["nao-uuid"],
        });
        expect(result.success).toBe(false);
    });

    it("aceita exatamente 10 anexos UUID", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            attachments: Array.from({ length: 10 }, () => UUID_A),
        });
        expect(result.success).toBe(true);
    });

    it("rejeita mais de 10 anexos", () => {
        const result = CreateTicketSchema.safeParse({
            ...baseValid,
            attachments: Array.from({ length: 11 }, () => UUID_A),
        });
        expect(result.success).toBe(false);
    });

    it("aplica default `[]` quando attachments é omitido", () => {
        const { attachments: _omit, ...rest } = baseValid;
        const result = CreateTicketSchema.safeParse(rest);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toEqual([]);
        }
    });
});

describe("UpdateTicketSchema", () => {
    it("aceita objeto vazio (todos os campos opcionais)", () => {
        const result = UpdateTicketSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it("aceita atualização parcial somente com title", () => {
        const result = UpdateTicketSchema.safeParse({ title: "novo título válido" });
        expect(result.success).toBe(true);
    });

    it("aceita atualização parcial somente com priority", () => {
        const result = UpdateTicketSchema.safeParse({ priority: "alta" });
        expect(result.success).toBe(true);
    });

    it("rejeita title que viola limite mínimo", () => {
        const result = UpdateTicketSchema.safeParse({ title: "abc" });
        expect(result.success).toBe(false);
    });

    it("rejeita title que viola limite máximo", () => {
        const result = UpdateTicketSchema.safeParse({ title: repeat("a", 121) });
        expect(result.success).toBe(false);
    });

    it("rejeita description abaixo do mínimo", () => {
        const result = UpdateTicketSchema.safeParse({ description: "curta" });
        expect(result.success).toBe(false);
    });

    it("rejeita departmentId não UUID", () => {
        const result = UpdateTicketSchema.safeParse({ departmentId: "abc" });
        expect(result.success).toBe(false);
    });

    it("rejeita prioridade inválida", () => {
        const result = UpdateTicketSchema.safeParse({ priority: "qualquer" });
        expect(result.success).toBe(false);
    });
});

describe("PostMessageSchema", () => {
    it("aceita body válido com isInternal omitido (default false)", () => {
        const result = PostMessageSchema.safeParse({ body: "Olá" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.isInternal).toBe(false);
        }
    });

    it("aceita isInternal=true explicitamente", () => {
        const result = PostMessageSchema.safeParse({ body: "Nota interna", isInternal: true });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.isInternal).toBe(true);
        }
    });

    it("rejeita body vazio", () => {
        const result = PostMessageSchema.safeParse({ body: "" });
        expect(result.success).toBe(false);
    });

    it("rejeita body com apenas espaços (após trim fica vazio)", () => {
        const result = PostMessageSchema.safeParse({ body: "   " });
        expect(result.success).toBe(false);
    });

    it("aceita body exatamente no limite mínimo (1 caractere)", () => {
        const result = PostMessageSchema.safeParse({ body: "a" });
        expect(result.success).toBe(true);
    });

    it("aceita body exatamente no limite máximo (5000 caracteres)", () => {
        const result = PostMessageSchema.safeParse({ body: repeat("a", 5000) });
        expect(result.success).toBe(true);
    });

    it("rejeita body com mais de 5000 caracteres", () => {
        const result = PostMessageSchema.safeParse({ body: repeat("a", 5001) });
        expect(result.success).toBe(false);
    });

    it("rejeita isInternal com tipo errado", () => {
        const result = PostMessageSchema.safeParse({
            body: "ok",
            isInternal: "sim" as unknown as boolean,
        });
        expect(result.success).toBe(false);
    });
});

describe("CreateUserSchema", () => {
    const baseValid = {
        email: "user@example.com",
        name: "Maria Silva",
        role: "tecnico" as const,
        departmentId: UUID_A,
        password: "senhaSegura123",
    };

    it("aceita um payload válido completo", () => {
        const result = CreateUserSchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    it("aceita sem departmentId (campo opcional)", () => {
        const { departmentId: _omit, ...rest } = baseValid;
        const result = CreateUserSchema.safeParse(rest);
        expect(result.success).toBe(true);
    });

    it("rejeita email inválido", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, email: "nao-email" });
        expect(result.success).toBe(false);
    });

    it("rejeita senha com menos de 8 caracteres", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, password: "1234567" });
        expect(result.success).toBe(false);
    });

    it("aceita senha exatamente no limite mínimo (8 caracteres)", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, password: "12345678" });
        expect(result.success).toBe(true);
    });

    it("aceita senha exatamente no limite máximo (128 caracteres)", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, password: repeat("a", 128) });
        expect(result.success).toBe(true);
    });

    it("rejeita senha com mais de 128 caracteres", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, password: repeat("a", 129) });
        expect(result.success).toBe(false);
    });

    it("rejeita papel fora do enum", () => {
        const result = CreateUserSchema.safeParse({
            ...baseValid,
            role: "superuser" as unknown as "admin",
        });
        expect(result.success).toBe(false);
    });

    it("aceita todos os papéis válidos", () => {
        for (const role of ["solicitante", "tecnico", "admin"] as const) {
            const result = CreateUserSchema.safeParse({ ...baseValid, role });
            expect(result.success).toBe(true);
        }
    });

    it("rejeita name muito curto", () => {
        const result = CreateUserSchema.safeParse({ ...baseValid, name: "M" });
        expect(result.success).toBe(false);
    });
});

describe("UpdateSlaPolicySchema", () => {
    it("aceita inteiro positivo de minutos", () => {
        const result = UpdateSlaPolicySchema.safeParse({ priority: "alta", minutes: 60 });
        expect(result.success).toBe(true);
    });

    it("rejeita zero minutos", () => {
        const result = UpdateSlaPolicySchema.safeParse({ priority: "alta", minutes: 0 });
        expect(result.success).toBe(false);
    });

    it("rejeita minutos negativos", () => {
        const result = UpdateSlaPolicySchema.safeParse({ priority: "alta", minutes: -1 });
        expect(result.success).toBe(false);
    });

    it("rejeita minutos decimais", () => {
        const result = UpdateSlaPolicySchema.safeParse({ priority: "alta", minutes: 1.5 });
        expect(result.success).toBe(false);
    });

    it("rejeita prioridade fora do enum", () => {
        const result = UpdateSlaPolicySchema.safeParse({ priority: "urgente", minutes: 30 });
        expect(result.success).toBe(false);
    });
});

describe("CreateCategorySchema", () => {
    const baseValid = {
        id: "hardware",
        label: "Hardware",
        sub: "Problemas com equipamentos físicos",
        icon: "monitor",
    };

    it("aceita payload válido", () => {
        const result = CreateCategorySchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    it("rejeita quando id está ausente", () => {
        const { id: _omit, ...rest } = baseValid;
        const result = CreateCategorySchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejeita quando label está ausente", () => {
        const { label: _omit, ...rest } = baseValid;
        const result = CreateCategorySchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejeita quando sub está ausente", () => {
        const { sub: _omit, ...rest } = baseValid;
        const result = CreateCategorySchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejeita quando icon está ausente", () => {
        const { icon: _omit, ...rest } = baseValid;
        const result = CreateCategorySchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejeita id excedendo o limite máximo (40)", () => {
        const result = CreateCategorySchema.safeParse({ ...baseValid, id: repeat("a", 41) });
        expect(result.success).toBe(false);
    });

    it("rejeita label excedendo o limite máximo (80)", () => {
        const result = CreateCategorySchema.safeParse({ ...baseValid, label: repeat("a", 81) });
        expect(result.success).toBe(false);
    });
});

describe("CreateKbArticleSchema", () => {
    const baseValid = {
        slug: "como-resetar-senha",
        title: "Como resetar a senha",
        body: "Passos detalhados para resetar a senha do sistema.",
        categoryId: "acesso",
        published: false,
    };

    it("aceita payload válido com slug em kebab-case", () => {
        const result = CreateKbArticleSchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    it("aplica default published=false quando omitido", () => {
        const { published: _omit, ...rest } = baseValid;
        const result = CreateKbArticleSchema.safeParse(rest);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.published).toBe(false);
        }
    });

    it("rejeita slug contendo letras maiúsculas", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, slug: "Como-Resetar" });
        expect(result.success).toBe(false);
    });

    it("rejeita slug com underscore", () => {
        const result = CreateKbArticleSchema.safeParse({
            ...baseValid,
            slug: "como_resetar_senha",
        });
        expect(result.success).toBe(false);
    });

    it("rejeita slug com espaços", () => {
        const result = CreateKbArticleSchema.safeParse({
            ...baseValid,
            slug: "como resetar",
        });
        expect(result.success).toBe(false);
    });

    it("rejeita slug com caracteres especiais", () => {
        const result = CreateKbArticleSchema.safeParse({
            ...baseValid,
            slug: "como-resetar!",
        });
        expect(result.success).toBe(false);
    });

    it("rejeita slug abaixo do mínimo (3)", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, slug: "ab" });
        expect(result.success).toBe(false);
    });

    it("aceita slug exatamente no limite mínimo (3)", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, slug: "abc" });
        expect(result.success).toBe(true);
    });

    it("rejeita slug acima do limite máximo (120)", () => {
        const result = CreateKbArticleSchema.safeParse({
            ...baseValid,
            slug: repeat("a", 121),
        });
        expect(result.success).toBe(false);
    });

    it("rejeita title abaixo do mínimo (5)", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, title: "abcd" });
        expect(result.success).toBe(false);
    });

    it("aceita title exatamente no limite mínimo (5)", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, title: "abcde" });
        expect(result.success).toBe(true);
    });

    it("rejeita title acima do limite máximo (160)", () => {
        const result = CreateKbArticleSchema.safeParse({
            ...baseValid,
            title: repeat("a", 161),
        });
        expect(result.success).toBe(false);
    });

    it("rejeita body abaixo do mínimo (10)", () => {
        const result = CreateKbArticleSchema.safeParse({ ...baseValid, body: "curto" });
        expect(result.success).toBe(false);
    });
});

describe("UploadConstraints", () => {
    it("define maxBytes em 25 MiB (26.214.400)", () => {
        expect(UploadConstraints.maxBytes).toBe(26_214_400);
        expect(UploadConstraints.maxBytes).toBe(25 * 1024 * 1024);
    });

    it("inclui os MIMEs esperados na allowlist", () => {
        const expectedMimes = [
            "image/png",
            "image/jpeg",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
            "text/x-log",
        ];
        for (const mime of expectedMimes) {
            expect(UploadConstraints.allowedMime).toContain(mime);
        }
    });

    it("não inclui MIMEs perigosos (executáveis, scripts)", () => {
        const blocked = [
            "application/x-msdownload",
            "application/x-sh",
            "text/html",
            "application/javascript",
        ];
        for (const mime of blocked) {
            expect(UploadConstraints.allowedMime).not.toContain(mime);
        }
    });
});
