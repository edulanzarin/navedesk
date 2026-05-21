/**
 * Schemas Zod compartilhados pela borda do NaveDesk.
 *
 * Toda entrada vinda de formulários, Server Actions ou Route Handlers
 * passa por um destes schemas antes de chegar à camada de serviço. Os
 * limites (min/max) refletem fielmente os critérios de aceitação dos
 * requisitos e devem ser a única fonte da verdade para validação.
 *
 * Os tipos `*Input` são inferidos para uso direto em formulários (ex.:
 * `react-hook-form`) e em assinaturas de funções de serviço.
 *
 * Validates: R3.1, R3.2, R7.1, R8.2, R8.3, R13.4, R14.2, R15.2.
 */

import { z } from "zod";

import { PRIORITIES, ROLES } from "./constants";

/**
 * Entrada para criação de ticket pelo solicitante.
 *
 * Os limites de tamanho aplicam-se *após* `trim`, garantindo que apenas
 * espaços em branco não satisfaçam o `min`. `attachments` aceita até 10
 * UUIDs de anexos previamente carregados via `POST /api/uploads`.
 *
 * Validates: R3.1, R3.2.
 */
export const CreateTicketSchema = z.object({
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(10).max(2000),
    categoryId: z.string().min(1),
    priority: z.enum(PRIORITIES),
    departmentId: z.string().uuid(),
    attachments: z.array(z.string().uuid()).max(10).default([]),
    /**
     * Quando informado, indica o solicitante "real" do ticket — o
     * `actor` está abrindo o chamado em nome de outra pessoa.
     * Apenas `admin`/`tecnico` podem usar este campo; o serviço
     * rejeita o uso por solicitantes (vira `FORBIDDEN`). Quando
     * omitido, `requesterId` é fixado como o próprio `actor`.
     */
    requesterId: z.string().uuid().optional(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

/**
 * Entrada para atualização parcial de um ticket existente.
 *
 * Todos os campos são opcionais — quando omitidos, o serviço preserva o
 * valor atual. A lista de anexos não está aqui porque vinculação posterior
 * acontece via fluxo dedicado de upload.
 *
 * Validates: R3.1.
 */
export const UpdateTicketSchema = z.object({
    title: z.string().trim().min(5).max(120).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    categoryId: z.string().min(1).optional(),
    priority: z.enum(PRIORITIES).optional(),
    departmentId: z.string().uuid().optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

/**
 * Entrada para postagem de mensagem em um ticket.
 *
 * `isInternal` defaulta a `false`; quando `true`, exige papel `tecnico`
 * ou `admin` (validação feita por policies, não por schema).
 *
 * Validates: R7.1.
 */
export const PostMessageSchema = z.object({
    body: z.string().trim().min(1).max(5000),
    isInternal: z.boolean().default(false),
    /**
     * UUIDs de anexos previamente carregados via `POST /api/uploads`
     * que serão vinculados à mensagem recém-criada.
     */
    attachments: z.array(z.string().uuid()).max(10).default([]),
});
export type PostMessageInput = z.infer<typeof PostMessageSchema>;

/**
 * Entrada para criação de usuário pelo admin.
 *
 * A senha trafega em texto puro apenas até o serviço, que a transforma em
 * `passwordHash` via `bcrypt(cost=12)` antes de persistir.
 *
 * Validates: R14.2.
 */
export const CreateUserSchema = z.object({
    email: z.string().email(),
    name: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    departmentId: z.string().uuid().optional(),
    password: z.string().min(8).max(128),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Entrada para auto-cadastro público em `/cadastro`.
 *
 * Diferenças em relação a `CreateUserSchema`:
 *
 * - Não aceita `role` — o serviço sempre cria como `solicitante`,
 *   garantindo que ninguém escale privilégios pela URL pública.
 * - `departmentId` é obrigatório (toda pessoa pertence a algum
 *   departamento; é o que define o escopo da abertura de chamados).
 * - `confirmPassword` é validado por `superRefine` para que o feedback
 *   apareça no campo correto.
 *
 * Mesmos limites de senha do `CreateUserSchema` para coerência da
 * política — 8..128 caracteres.
 */
export const RegisterSchema = z
    .object({
        email: z.string().email(),
        name: z.string().trim().min(2).max(120),
        departmentId: z.string().uuid(),
        password: z.string().min(8).max(128),
        confirmPassword: z.string().min(1),
    })
    .superRefine((data, ctx) => {
        if (data.password !== data.confirmPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["confirmPassword"],
                message: "A confirmação não corresponde à senha.",
            });
        }
    });
export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Entrada para reset de senha pelo admin (R14).
 *
 * Diferente de `ChangePasswordSchema` (que exige a senha atual), este
 * fluxo é administrativo: o admin define uma senha provisória que o
 * próprio usuário trocará no primeiro login via `/perfil`. Mesmos
 * limites (8..128) para manter a política de senhas coerente.
 */
export const ResetPasswordSchema = z.object({
    userId: z.string().uuid(),
    newPassword: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/**
 * Entrada para atualização de uma política de SLA.
 *
 * `minutes` deve ser um inteiro positivo (mínimo 1 minuto); tickets já
 * existentes preservam seu `slaDeadline` (a nova política se aplica
 * apenas a tickets futuros). A unidade é minutos para permitir prazos
 * sub-hora — ex.: 30 minutos para prioridade `critica`.
 *
 * Validates: R15.2.
 */
export const UpdateSlaPolicySchema = z.object({
    priority: z.enum(PRIORITIES),
    minutes: z.number().int().positive(),
});
export type UpdateSlaPolicyInput = z.infer<typeof UpdateSlaPolicySchema>;

/**
 * Entrada para criação de uma categoria de chamado.
 *
 * `id` é uma chave estável usada também no banco e em URLs, por isso é
 * limitado a um identificador curto. `icon` referencia um ícone Lucide.
 *
 * Validates: R15.2.
 */
export const CreateCategorySchema = z.object({
    id: z.string().min(1).max(40),
    label: z.string().trim().min(1).max(80),
    sub: z.string().trim().min(1).max(120),
    icon: z.string().min(1),
});
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

/**
 * Entrada para criação de um departamento.
 *
 * Departamentos são uma taxonomia simples — apenas `name` único.
 * Limites de tamanho cobrem nomes curtos ("TI", "RH") até completos
 * ("Departamento de Recursos Humanos") sem permitir abuso. O `trim`
 * garante que sequências apenas com espaço não satisfaçam o `min`.
 *
 * Validates: R15.
 */
export const CreateDepartmentSchema = z.object({
    name: z.string().trim().min(2).max(80),
});
export type CreateDepartmentInput = z.infer<typeof CreateDepartmentSchema>;

/**
 * Entrada para renomear um departamento existente. Espelha o shape de
 * criação porque `name` é o único atributo mutável.
 *
 * Validates: R15.
 */
export const UpdateDepartmentSchema = z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(80),
});
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;

/**
 * Entrada para criação de um artigo da Base de Conhecimento.
 *
 * O `slug` é validado contra um conjunto restrito de caracteres para
 * permitir uso seguro em URLs sem encoding adicional.
 *
 * Validates: R13.4.
 */
export const CreateKbArticleSchema = z.object({
    slug: z
        .string()
        .trim()
        .min(3)
        .max(120)
        .regex(/^[a-z0-9-]+$/),
    title: z.string().trim().min(5).max(160),
    body: z.string().trim().min(10),
    categoryId: z.string().min(1),
    published: z.boolean().default(false),
});
export type CreateKbArticleInput = z.infer<typeof CreateKbArticleSchema>;

/**
 * Entrada para edição de um artigo da Base de Conhecimento.
 *
 * Permite alterar `title`, `body`, `categoryId`, `published` e o próprio
 * `slug` (caso o autor queira renomear a URL do artigo). O conjunto de
 * campos é o mesmo da criação e usa as mesmas restrições para
 * preservar consistência. A identificação do artigo alvo vai por fora
 * do payload (no parâmetro `slug` da Server Action), por isso ele
 * **não** aparece como obrigatório aqui — é derivado do schema base
 * sem ajustes adicionais.
 *
 * Validates: R13.
 */
export const UpdateKbArticleSchema = CreateKbArticleSchema;
export type UpdateKbArticleInput = z.infer<typeof UpdateKbArticleSchema>;

/**
 * Entrada para a sugestão de artigos da Base de Conhecimento durante a
 * digitação do título de um novo ticket (R13.8).
 *
 * Limites:
 *
 * - `min(3)` evita disparar consultas para termos muito curtos, que
 *   produziriam matches dispersos e nenhum ganho de deflexão. Também
 *   protege o banco de varreduras com `ILIKE '%a%'`.
 * - `max(100)` impede que um campo de título patológico (até 120
 *   caracteres pelo `CreateTicketSchema`) sature o servidor; a UI
 *   normalmente passa o título atual diretamente, então alguma folga
 *   seria desnecessária — escolhemos 100 para deixar margem sem inflar
 *   a query.
 * - `trim()` aplicado para que sequências de espaços não passem da
 *   borda como entradas válidas.
 *
 * Validates: R13.8.
 */
export const KbSuggestQuerySchema = z.object({
    query: z.string().trim().min(3).max(100),
});
export type KbSuggestQueryInput = z.infer<typeof KbSuggestQuerySchema>;

/**
 * Entrada para troca de senha pelo próprio usuário em `/perfil`.
 *
 * Diferente do fluxo administrativo, aqui exigimos a senha atual antes
 * de aplicar a nova — o serviço compara `currentPassword` contra o
 * `passwordHash` armazenado, recusando a operação se houver divergência.
 *
 * Os limites do `newPassword` espelham `CreateUserSchema.password`
 * (8..128 caracteres), mantendo a política de senhas única em todo o
 * domínio. A confirmação é validada via `superRefine` quando difere de
 * `newPassword`, anexando o erro ao próprio campo `confirmPassword` para
 * que o formulário marque o input correto. O campo `currentPassword`
 * apenas exige presença não-vazia: a verificação real é feita no
 * servidor via `bcrypt.compare`, sempre com mensagem genérica para não
 * revelar nada sobre o hash.
 *
 * Validates: R1.6.
 */
export const ChangePasswordSchema = z
    .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
        confirmPassword: z.string().min(1),
    })
    .superRefine((data, ctx) => {
        if (data.newPassword !== data.confirmPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["confirmPassword"],
                message: "A confirmação não corresponde à nova senha.",
            });
        }
        if (data.newPassword === data.currentPassword) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["newPassword"],
                message: "A nova senha deve ser diferente da atual.",
            });
        }
    });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Entrada para atualização da aparência do avatar (R1.6).
 *
 * - `color` aceita um hex `#RRGGBB` (case-insensitive). Validamos o
 *   formato aqui para que a UI não consiga gravar valores arbitrários
 *   (ex.: cor inválida injetada via DevTools).
 * - `avatarUrl` é opcional e aceita uma URL relativa do tipo
 *   `/api/uploads/{uuid}` — exatamente o que o handler de upload
 *   devolve. Strings vazias são normalizadas para `null` antes de
 *   gravar, permitindo que o usuário "remova" a foto.
 *
 * O cliente envia uma das duas chaves (ou ambas) por requisição;
 * todas opcionais para permitir mudanças incrementais.
 *
 * Validates: R1.6.
 */
export const UpdateAvatarSchema = z
    .object({
        color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.")
            .optional(),
        avatarUrl: z
            .union([
                z.string().regex(/^\/api\/uploads\/[a-f0-9-]{36}$/),
                z.literal(""),
                z.null(),
            ])
            .optional(),
    })
    .refine(
        (data) => data.color !== undefined || data.avatarUrl !== undefined,
        {
            message: "Informe pelo menos um campo para atualizar.",
        },
    );
export type UpdateAvatarInput = z.infer<typeof UpdateAvatarSchema>;

/**
 * Restrições aplicadas no upload de anexos.
 *
 * - `maxBytes`: limite de 25 MiB (`26_214_400`), conforme R8.3.
 * - `allowedMime`: allowlist de MIME types aceitos pelo `POST /api/uploads`.
 *   A validação de magic bytes (via `file-type`) é feita na própria rota
 *   para impedir spoofing do MIME declarado pelo cliente.
 *
 * Validates: R8.2, R8.3.
 */
export const UploadConstraints = {
    maxBytes: 25 * 1024 * 1024,
    allowedMime: [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/webm",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "text/x-log",
    ] as const,
} as const;

/** MIME type aceito pelo upload, derivado de `UploadConstraints.allowedMime`. */
export type AllowedMime = (typeof UploadConstraints.allowedMime)[number];
