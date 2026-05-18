# Requirements Document

## Introduction

O **NaveDesk** é o sistema interno de central de chamados (helpdesk) do time de TI da Contábil Andrade. O produto permite que colaboradores (Solicitantes) abram chamados, que Técnicos de TI atendam respeitando prazos de SLA por prioridade, e que Administradores configurem o sistema (usuários, políticas de SLA, categorias). A interface é em português brasileiro (pt-BR), segue a paleta índigo `#5E5CE6` e tipografia Geist definidas nas mockups, e é entregue como um aplicativo Next.js 15 + PostgreSQL 16 orquestrado por Docker Compose, com migrations automáticas e seed idempotente no boot.

Este documento deriva da arquitetura descrita em `design.md` e formaliza, em padrão EARS, as obrigações funcionais e não funcionais do sistema. Cada requisito referencia a seção do design quando aplicável.

## Glossary

- **NaveDesk_Sistema**: Aplicação web completa (frontend Next.js + API + banco PostgreSQL) que implementa a central de chamados. Quando um requisito não distingue subsistema, o ator é o NaveDesk_Sistema como um todo.
- **Servico_Auth**: Camada de autenticação baseada em Auth.js v5 (Credentials provider, JWT em cookie HttpOnly).
- **Servico_Tickets**: Camada `services/tickets.service.ts` que implementa criação, atualização, atribuição e mudança de status de chamados.
- **Servico_Mensagens**: Camada que persiste e recupera mensagens e notas internas de um chamado.
- **Servico_KB**: Camada da base de conhecimento (artigos, categorias, busca).
- **Servico_Admin**: Camada que executa operações administrativas (usuários, políticas SLA, categorias).
- **Servico_Stats**: Camada `services/stats.service.ts` que calcula KPIs e dados agregados do dashboard.
- **Servico_Upload**: Route Handler `POST /api/uploads` que recebe, valida e persiste anexos.
- **Servico_Download**: Route Handler `GET /api/uploads/[id]` que serve anexos com verificação de permissão.
- **Maquina_Estados**: Função pura `lib/ticket-state.ts::transitionTicketStatus` que decide o próximo status de um ticket dado o status atual e a ação.
- **Calculo_SLA**: Funções puras `lib/sla.ts::computeSlaDeadline` e `computeSlaInfo`.
- **Gerador_ID**: Função `lib/ticket-id.ts::nextTicketId` que produz identificadores no formato `NVD-XXXX` via sequência Postgres `ticket_seq`.
- **RBAC**: Conjunto de funções puras em `lib/policies.ts` (`canCreateTicket`, `canChangeStatus`, `canAssignSelf`, `canReadAttachment`, etc.) que decidem autorização.
- **Trilha_Auditoria**: Tabela `ticket_events` que registra `created`, `status_changed`, `priority_changed`, `assigned`, `unassigned`, `rated`, `closed`.
- **Solicitante**: Papel `solicitante`. Colaborador comum que abre chamados.
- **Tecnico**: Papel `tecnico`. Membro do time de TI que atende e resolve chamados.
- **Admin**: Papel `admin`. Configura usuários, políticas e categorias.
- **Ticket**: Registro de chamado com identificador `NVD-XXXX`, título, descrição, status, prioridade, categoria, departamento, solicitante, possível responsável, deadline de SLA, eventual avaliação e timestamps de criação, atualização, resolução e fechamento.
- **Status**: Um de `aberto`, `andamento`, `aguardando`, `resolvido`, `fechado`.
- **Prioridade**: Um de `baixa`, `media`, `alta`, `critica`.
- **Politica_SLA**: Linha em `sla_policies` que mapeia prioridade para horas (default: baixa=48, media=24, alta=8, critica=2).
- **SLA_Info**: Estrutura `{ level, remainingMs, pctElapsed }` onde `level ∈ {ok, warn, crit, breached}`.
- **Nota_Interna**: Mensagem com flag `isInternal=true`, visível apenas a Tecnico e Admin.
- **Anexo**: Arquivo persistido em `attachments`, vinculado a um ticket ou mensagem.
- **Categoria**: Linha em `categories` (ex.: hardware, software, sistema, rede, acesso, email).
- **Departamento**: Linha em `departments` (ex.: Fiscal, Contabilidade).
- **KB_Artigo**: Artigo em `kb_articles` (markdown sanitizado, com slug único, categoria, autor, contador de visualizações e flag `published`).
- **Bootstrap_Compose**: Sequência executada pelo serviço `app` no `docker-compose.yml`: `db:migrate` → `db:seed:if-empty` → `start server`.
- **Seed_Idempotente**: Script `db:seed:if-empty` que popula categorias, departamentos, políticas SLA e usuários de exemplo somente quando a tabela `users` está vazia.

## Requirements

### Requirement 1: Autenticação por credenciais

**User Story:** Como colaborador da Contábil Andrade, eu quero entrar no NaveDesk com e-mail e senha, para acessar funcionalidades restritas ao meu papel.

#### Acceptance Criteria

1. WHEN um usuário não autenticado acessa qualquer rota dentro de `(app)`, THE NaveDesk_Sistema SHALL redirecionar a navegação para `/login` preservando a URL de destino em parâmetro `next`.
2. WHEN um usuário submete o formulário de login com e-mail e senha, THE Servico_Auth SHALL verificar o par credenciais comparando a senha contra o hash bcrypt armazenado em `users.password_hash`.
3. IF as credenciais não correspondem a um usuário ativo, THEN THE Servico_Auth SHALL rejeitar a tentativa e exibir mensagem de erro genérica sem revelar se o e-mail existe.
4. WHEN as credenciais são válidas e o usuário tem `active=true`, THE Servico_Auth SHALL emitir um JWT armazenado em cookie HttpOnly com SameSite=Lax e redirecionar para `/dashboard`.
5. IF o usuário possui `active=false`, THEN THE Servico_Auth SHALL rejeitar o login mesmo com senha correta.
6. WHILE a sessão JWT está válida, THE NaveDesk_Sistema SHALL expor as informações `{ id, email, name, role, departmentId }` ao Server Component através de `auth()`.
7. WHEN o JWT expira ou é inválido, THE NaveDesk_Sistema SHALL redirecionar para `/login` na próxima requisição autenticada.
8. WHEN o usuário aciona logout, THE Servico_Auth SHALL invalidar o cookie de sessão e redirecionar para `/login`.
9. THE Servico_Auth SHALL aplicar limite de taxa de 10 tentativas de login por minuto por endereço IP.

> Referência de design: seções *Architecture*, *Diagramas de Sequência → Fluxo de login*, *Considerações de Segurança*.

### Requirement 2: Autorização baseada em papéis (RBAC)

**User Story:** Como gestor do produto, eu quero que cada papel só execute ações compatíveis com sua função, para garantir que solicitantes, técnicos e administradores tenham privilégios apropriados.

#### Acceptance Criteria

1. THE NaveDesk_Sistema SHALL reconhecer exatamente três papéis: `solicitante`, `tecnico` e `admin`.
2. WHERE o usuário tem papel `admin`, THE RBAC SHALL conceder permissão para todas as operações de domínio, incluindo administração de usuários, políticas de SLA e categorias.
3. WHERE o usuário tem papel `tecnico`, THE RBAC SHALL conceder permissão para listar e visualizar todos os tickets, assumir tickets para si, alterar status, prioridade, atribuição e postar mensagens internas.
4. WHERE o usuário tem papel `solicitante`, THE RBAC SHALL restringir a visualização de tickets aos chamados em que `requesterId === user.id`.
5. WHEN uma Server Action ou Route Handler é invocado, THE NaveDesk_Sistema SHALL revalidar a permissão correspondente via função pura em `lib/policies.ts` antes de executar qualquer escrita.
6. IF a verificação RBAC retorna `false`, THEN THE NaveDesk_Sistema SHALL retornar `ActionResult` com `ok=false` e `error.code="FORBIDDEN"` sem aplicar mutações.
7. THE NaveDesk_Sistema SHALL ocultar na UI os controles cujas ações o usuário corrente não tem permissão de executar.
8. WHEN um Solicitante tenta acessar uma rota administrativa (`/admin/*`), THE NaveDesk_Sistema SHALL responder com 403 ou redirecionar para `/dashboard`.

> Referência de design: *Components and Interfaces → Server Actions*, *Considerações de Segurança → RBAC em duas camadas*, *Algoritmos → canChangeStatus*.

### Requirement 3: Criação de ticket

**User Story:** Como Solicitante, eu quero abrir um chamado descrevendo meu problema com categoria, departamento, prioridade e anexos, para que o time de TI receba minha demanda formalizada.

#### Acceptance Criteria

1. WHEN um Solicitante autenticado submete o formulário de novo ticket com `title` (5..120 caracteres após trim), `description` (10..2000 caracteres após trim), `categoryId`, `departmentId` (UUID), `priority ∈ {baixa, media, alta, critica}` e até 10 IDs de anexos, THE Servico_Tickets SHALL criar um novo Ticket persistido com `status="aberto"` e `requesterId` igual ao id do usuário autenticado.
2. IF qualquer campo obrigatório do formulário falha na validação Zod (`CreateTicketSchema`), THEN THE NaveDesk_Sistema SHALL rejeitar a criação e retornar `ActionResult.error` com `field` apontando o primeiro campo inválido.
3. WHEN um ticket é criado, THE Gerador_ID SHALL atribuir um identificador no formato `NVD-{n}` onde `n` vem da sequência Postgres `ticket_seq`.
4. WHEN um ticket é criado, THE Calculo_SLA SHALL definir `slaDeadline = createdAt + horas(prioridade)` lendo a Politica_SLA vigente.
5. WHEN um ticket é criado, THE Servico_Tickets SHALL registrar um evento `created` em `ticket_events` com `actorId = requesterId` e `toValue = "aberto"` na mesma transação do INSERT do ticket.
6. WHEN o usuário envia anexos junto à criação, THE Servico_Tickets SHALL associar cada anexo somente se o anexo pertence ao próprio uploader e ainda não está vinculado a outro ticket.
7. WHEN a criação é concluída com sucesso, THE NaveDesk_Sistema SHALL revalidar o cache de listagens e redirecionar o navegador para `/tickets/{ticketId}`.
8. THE NaveDesk_Sistema SHALL permitir a Tecnico e Admin pré-atribuir um responsável no ato da criação quando `allowAssign=true`; Solicitantes nunca podem atribuir.

> Referência de design: *Diagramas de Sequência → criação de ticket*, *Algoritmos → createTicket*, *Regras de validação Zod*.

### Requirement 4: Ciclo de vida do ticket (máquina de estados)

**User Story:** Como Técnico, eu quero que as transições de status sigam regras claras, para que o ciclo de vida do chamado seja consistente e auditável.

#### Acceptance Criteria

1. THE Maquina_Estados SHALL aceitar exatamente os estados `aberto`, `andamento`, `aguardando`, `resolvido`, `fechado` e as ações `ASSIGN`, `WAIT_REQUESTER`, `RESPOND`, `RESOLVE`, `REOPEN`, `CLOSE`.
2. WHEN a ação `ASSIGN` é aplicada em um ticket com status `aberto`, THE Maquina_Estados SHALL retornar `andamento`.
3. WHEN a ação `WAIT_REQUESTER` é aplicada em um ticket com status `aberto` ou `andamento`, THE Maquina_Estados SHALL retornar `aguardando`.
4. WHEN a ação `RESPOND` é aplicada em um ticket com status `aguardando` ou `resolvido`, THE Maquina_Estados SHALL retornar `andamento`.
5. WHEN a ação `RESOLVE` é aplicada em qualquer status diferente de `fechado`, THE Maquina_Estados SHALL retornar `resolvido`.
6. WHEN a ação `REOPEN` é aplicada em um ticket com status `resolvido` ou `fechado`, THE Maquina_Estados SHALL retornar `aberto`.
7. WHEN a ação `CLOSE` é aplicada em qualquer status, THE Maquina_Estados SHALL retornar `fechado`.
8. IF uma transição não consta da tabela de transições aceitas, THEN THE Maquina_Estados SHALL lançar `IllegalStateTransitionError` contendo `current` e `action`.
9. THE Maquina_Estados SHALL ser uma função pura, determinística e total sobre o produto cartesiano de estados e ações válidos.
10. WHEN o status passa para `resolvido` e `resolvedAt` está nulo, THE Servico_Tickets SHALL atribuir `resolvedAt = now`.
11. WHEN o status passa para `fechado`, THE Servico_Tickets SHALL atribuir `closedAt = now`.
12. WHEN qualquer mudança de status é persistida, THE Servico_Tickets SHALL gravar um evento `status_changed` em `ticket_events` com `fromValue` e `toValue` na mesma transação do UPDATE.

> Referência de design: *Algoritmos → transitionTicketStatus*, *Algoritmos → changeTicketStatus*.

### Requirement 5: Atribuição de tickets

**User Story:** Como Técnico, eu quero assumir tickets ou ser atribuído pelo administrador, para que a responsabilidade pelo atendimento fique clara.

#### Acceptance Criteria

1. WHEN um Tecnico aciona "Assumir" em um ticket, THE Servico_Tickets SHALL definir `assigneeId = user.id` desde que a função `RBAC.canAssignSelf(user, ticket)` retorne `true`.
2. WHERE o ticket tem status `aberto` no momento da auto-atribuição, THE Servico_Tickets SHALL aplicar a ação `ASSIGN` na Maquina_Estados, transicionando para `andamento`.
3. WHEN um Admin atribui um ticket a outro usuário, THE Servico_Tickets SHALL aceitar somente ids de usuários com papel `tecnico` ou `admin` e `active=true`.
4. WHEN a atribuição é alterada, THE Servico_Tickets SHALL gravar um evento `assigned` em `ticket_events` com `fromValue = assigneeId anterior ou null` e `toValue = novo assigneeId`.
5. WHEN um Admin remove a atribuição (assignee passa a `null`), THE Servico_Tickets SHALL gravar um evento `unassigned`.
6. IF um Solicitante tenta atribuir um ticket, THEN THE NaveDesk_Sistema SHALL rejeitar com `ActionResult.error.code="FORBIDDEN"`.
7. THE NaveDesk_Sistema SHALL listar para Tecnico e Admin uma rota `/tickets/atribuidos` mostrando apenas tickets cujo `assigneeId` é o usuário corrente.

> Referência de design: *Diagramas de Sequência → técnico assumindo*, *Components and Interfaces → assignTicket / assignTicketToMe*.

### Requirement 6: Cálculo e exposição de SLA

**User Story:** Como Técnico, eu quero ver claramente o prazo de SLA restante de cada ticket, para priorizar atendimentos e evitar estouros.

#### Acceptance Criteria

1. THE Politica_SLA SHALL ter, no estado padrão, os valores `baixa=48h`, `media=24h`, `alta=8h`, `critica=2h`.
2. WHEN um ticket é criado, THE Calculo_SLA SHALL produzir `slaDeadline` igual a `createdAt + policy.hours * 3_600_000 ms` para a prioridade do ticket.
3. WHEN o sistema renderiza o medidor de SLA, THE Calculo_SLA SHALL retornar `SLA_Info` com `remainingMs = deadline - now` e `pctElapsed = clamp(100 - remainingMs/totalMs * 100, 0, 100)`.
4. WHEN `remainingMs > totalMs * 0.25`, THE Calculo_SLA SHALL classificar `level="ok"`.
5. WHEN `remainingMs ≤ totalMs * 0.25` e `remainingMs > totalMs * 0.10`, THE Calculo_SLA SHALL classificar `level="warn"`.
6. WHEN `remainingMs ≤ totalMs * 0.10` e `remainingMs > 0`, THE Calculo_SLA SHALL classificar `level="crit"`.
7. WHEN `remainingMs ≤ 0`, THE Calculo_SLA SHALL classificar `level="breached"`.
8. WHILE o ticket está em status `resolvido` ou `fechado`, THE NaveDesk_Sistema SHALL exibir o medidor de SLA como inativo (símbolo "—").
9. THE Calculo_SLA SHALL ser puro: para o mesmo `(deadline, priority, policies, now)`, sempre produzir o mesmo `SLA_Info`.
10. WHEN um Admin altera as horas de uma Politica_SLA, THE Servico_Admin SHALL aplicar a nova política apenas a tickets criados após a alteração; tickets existentes preservam seu `slaDeadline`.

> Referência de design: *Algoritmos → computeSlaDeadline / computeSlaInfo*, *Correctness Properties 1–3*.

### Requirement 7: Conversa em ticket (mensagens públicas e notas internas)

**User Story:** Como Solicitante ou Técnico, eu quero conversar sobre um ticket através de mensagens, e como Técnico ou Admin, eu quero registrar notas internas, para que a colaboração fique documentada com a visibilidade adequada.

#### Acceptance Criteria

1. WHEN um usuário com permissão de visualizar o ticket envia uma mensagem com `body` (1..5000 caracteres após trim) e `isInternal=false`, THE Servico_Mensagens SHALL persistir a mensagem em `ticket_messages` com `authorId = user.id` e timestamp `createdAt = now`.
2. WHERE o autor é Tecnico ou Admin e marca `isInternal=true`, THE Servico_Mensagens SHALL persistir a mensagem como Nota_Interna.
3. IF um Solicitante tenta postar mensagem com `isInternal=true`, THEN THE NaveDesk_Sistema SHALL rejeitar a operação retornando `FORBIDDEN`.
4. WHEN um Solicitante visualiza um ticket, THE Servico_Mensagens SHALL retornar somente mensagens com `isInternal=false`.
5. WHEN um Tecnico ou Admin visualiza um ticket, THE Servico_Mensagens SHALL retornar todas as mensagens, incluindo Notas_Internas.
6. WHEN o conteúdo de uma mensagem é renderizado, THE NaveDesk_Sistema SHALL processar markdown através de `react-markdown` com `rehype-sanitize` ativo (allowlist), impedindo execução de scripts.
7. WHEN uma mensagem é postada com sucesso, THE NaveDesk_Sistema SHALL revalidar a página `/tickets/{id}` para refletir a nova mensagem.
8. THE Servico_Mensagens SHALL ordenar a conversa cronologicamente (ascendente por `createdAt`).

> Referência de design: *Components and Interfaces → postMessage*, *Considerações de Segurança → XSS*.

### Requirement 8: Anexos com limites de tamanho e tipo

**User Story:** Como usuário do NaveDesk, eu quero anexar arquivos relevantes ao ticket ou à mensagem, para complementar o atendimento.

#### Acceptance Criteria

1. WHEN um usuário envia um arquivo via `POST /api/uploads`, THE Servico_Upload SHALL aceitar somente requisições autenticadas.
2. THE Servico_Upload SHALL rejeitar arquivos cujo MIME declarado não esteja em `{image/png, image/jpeg, application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/plain, text/x-log}`.
3. THE Servico_Upload SHALL rejeitar arquivos cujo tamanho exceda `25 MiB` (`26_214_400 bytes`).
4. WHEN o arquivo é aceito, THE Servico_Upload SHALL validar o MIME real através de magic bytes (`file-type`) e rejeitar se divergir do MIME declarado.
5. WHEN o arquivo é aceito, THE Servico_Upload SHALL persistir o conteúdo em `public/uploads/{yyyy}/{mm}/{uuid}.{ext}` usando UUID como nome de arquivo (nunca o nome original).
6. WHEN o arquivo é persistido, THE Servico_Upload SHALL gravar uma linha em `attachments` com `name`, `mime`, `sizeBytes`, `storageKey`, `uploaderId`.
7. WHEN um cliente requisita `GET /api/uploads/[id]`, THE Servico_Download SHALL verificar `RBAC.canReadAttachment(user, attachment)` e responder com `404` se a permissão for negada (sem revelar existência).
8. WHERE o tipo do anexo não é imagem, THE Servico_Download SHALL incluir o cabeçalho `Content-Disposition: attachment` na resposta.
9. THE Servico_Upload SHALL aplicar limite de taxa de 30 uploads por minuto por usuário.

> Referência de design: *Components and Interfaces → Route Handlers*, *Considerações de Segurança → Uploads*.

### Requirement 9: Geração de identificadores de ticket

**User Story:** Como gestor, eu quero que cada chamado tenha um identificador legível, único e crescente (ex.: NVD-1043), para facilitar referência interna.

#### Acceptance Criteria

1. THE Gerador_ID SHALL produzir identificadores no formato `^[A-Z]{2,4}-[0-9]+$`, usando o prefixo `NVD` para tickets do produto.
2. WHEN `nextTicketId("NVD")` é invocado, THE Gerador_ID SHALL obter o próximo valor através de `SELECT nextval('ticket_seq')` em transação.
3. WHEN duas ou mais chamadas concorrentes ocorrem, THE Gerador_ID SHALL garantir que cada chamada receba um inteiro distinto, sem colisões.
4. WHEN chamadas sequenciais ocorrem, THE Gerador_ID SHALL produzir inteiros estritamente crescentes para o mesmo prefixo.
5. THE Gerador_ID SHALL usar `ticket_seq` iniciada em `1042` com incremento `1`.

> Referência de design: *Algoritmos → nextTicketId*, *Correctness Properties 7–8*.

### Requirement 10: Dashboard com KPIs e alertas

**User Story:** Como gestor de TI ou Técnico, eu quero ver no dashboard os principais indicadores do dia e os tickets em risco de SLA, para tomar decisões rápidas.

#### Acceptance Criteria

1. WHEN um Tecnico ou Admin acessa `/dashboard`, THE Servico_Stats SHALL retornar KPIs incluindo `tickets_abertos`, `tickets_em_andamento`, `tickets_aguardando`, `tickets_resolvidos_hoje`, `tickets_estourando_sla`.
2. THE Servico_Stats SHALL fornecer a distribuição de tickets ativos (`status ≠ fechado`) por prioridade.
3. THE Servico_Stats SHALL fornecer a distribuição de tickets ativos por categoria.
4. THE Servico_Stats SHALL fornecer um feed das últimas atividades baseado em `ticket_events` ordenado descendentemente por `createdAt`, limitado a 20 entradas.
5. WHEN existir pelo menos um ticket com SLA `breached` ou `crit` e status diferente de `resolvido`/`fechado`, THE NaveDesk_Sistema SHALL destacar visualmente um alerta de SLA no dashboard.
6. WHERE o usuário é Solicitante, THE Servico_Stats SHALL escopar todos os KPIs e listas aos chamados em que `requesterId === user.id`.
7. THE NaveDesk_Sistema SHALL renderizar o dashboard como Server Component, com SLA ao vivo apenas nos componentes interativos (`"use client"`).

> Referência de design: *Considerações de Performance*, *Components and Interfaces → KpiCard*.

### Requirement 11: Listagem de tickets com filtros

**User Story:** Como Técnico ou Admin, eu quero filtrar e ordenar a lista de tickets, para encontrar rapidamente o que preciso.

#### Acceptance Criteria

1. WHEN um Tecnico ou Admin acessa `/tickets`, THE Servico_Tickets SHALL retornar todos os tickets, paginados em páginas de 50 linhas usando cursor `(updated_at, id)`.
2. THE NaveDesk_Sistema SHALL aceitar filtros via query string para `status`, `priority`, `categoryId`, `departmentId`, `assigneeId`, `requesterId` e busca textual em `title`/`id`.
3. WHEN o filtro `assigneeId=me` é informado, THE Servico_Tickets SHALL retornar somente tickets cujo `assigneeId` é o usuário autenticado.
4. WHERE o usuário é Solicitante, THE Servico_Tickets SHALL aplicar implicitamente o filtro `requesterId = user.id` independente da query string.
5. THE NaveDesk_Sistema SHALL ordenar a listagem por `updated_at DESC` por padrão e permitir ordenação alternativa por `createdAt`, `priority` e `slaDeadline`.
6. WHEN o usuário aciona "Exportar", THE NaveDesk_Sistema SHALL gerar um arquivo `.csv` ou `.xlsx` contendo as colunas `id, title, status, priority, category, department, requester, assignee, createdAt, slaDeadline, resolvedAt` respeitando o filtro corrente.
7. WHERE o usuário é Solicitante, THE NaveDesk_Sistema SHALL garantir que o arquivo exportado contenha apenas os tickets cujo `requesterId` é o seu próprio.

> Referência de design: *Considerações de Performance → Paginação*, *Components and Interfaces → DataTable*.

### Requirement 12: Visualização e operação no detalhe do ticket

**User Story:** Como usuário, eu quero abrir o detalhe de um ticket para ver toda a sua informação, conversar e executar as ações permitidas pelo meu papel.

#### Acceptance Criteria

1. WHEN um usuário com permissão acessa `/tickets/{id}`, THE NaveDesk_Sistema SHALL apresentar título, identificador `NVD-XXXX`, descrição, categoria, departamento, prioridade, status, solicitante, responsável (se houver), data de criação, deadline de SLA e medidor de SLA.
2. THE NaveDesk_Sistema SHALL exibir a conversa do ticket (mensagens visíveis ao papel) e o histórico (`ticket_events`).
3. THE NaveDesk_Sistema SHALL exibir, para Tecnico e Admin, os controles de mudança de status, mudança de prioridade, atribuição e postagem de Nota_Interna.
4. WHERE o usuário é Solicitante e o ticket está em status `resolvido`, THE NaveDesk_Sistema SHALL exibir um controle para confirmar fechamento (transição `RESOLVE→fechado` via ação `CLOSE`).
5. WHERE o usuário é Solicitante e o ticket está em status `resolvido`, THE NaveDesk_Sistema SHALL exibir o controle de avaliação (1..5 estrelas).
6. WHEN o Solicitante avalia o ticket, THE Servico_Tickets SHALL gravar `rating ∈ {1,2,3,4,5}` em `tickets` e um evento `rated` com `toValue = rating` em `ticket_events`.
7. IF um usuário sem permissão tenta acessar o detalhe, THEN THE NaveDesk_Sistema SHALL responder com 404 (sem revelar existência).
8. WHEN o status, prioridade ou atribuição mudam na UI, THE NaveDesk_Sistema SHALL revalidar a página para refletir a atualização sem reload manual.

> Referência de design: *Components and Interfaces → ticket-form, ticket-conversation, ticket-history*, *Algoritmos → canChangeStatus*.

### Requirement 13: Base de Conhecimento (KB)

**User Story:** Como usuário, eu quero consultar artigos da base de conhecimento e como Técnico/Admin, eu quero criar e publicar artigos, para reduzir chamados repetitivos.

#### Acceptance Criteria

1. WHEN um usuário acessa `/kb`, THE Servico_KB SHALL listar categorias e artigos publicados (`published=true`).
2. WHERE o usuário é Tecnico ou Admin, THE Servico_KB SHALL exibir também rascunhos (`published=false`) de autoria do próprio usuário.
3. WHEN o usuário busca por termo, THE Servico_KB SHALL retornar artigos cujo título ou corpo contém o termo, ordenados por relevância textual.
4. WHEN um Tecnico ou Admin cria um artigo via `/kb/novo`, THE Servico_KB SHALL persistir `slug` único, `title`, `body` (markdown), `categoryId`, `authorId`, `published`.
5. IF o slug informado já existe em `kb_articles`, THEN THE Servico_KB SHALL rejeitar a criação retornando erro de conflito.
6. WHEN um usuário visualiza um artigo publicado, THE Servico_KB SHALL incrementar atomicamente `views` em 1.
7. WHEN o corpo do artigo é renderizado, THE NaveDesk_Sistema SHALL aplicar markdown sanitizado (`rehype-sanitize`) impedindo execução de scripts.
8. WHEN um Solicitante está digitando o título de um novo ticket, THE NaveDesk_Sistema SHALL sugerir até 5 artigos publicados relevantes ao título.
9. IF um Solicitante tenta acessar `/kb/novo`, THEN THE NaveDesk_Sistema SHALL rejeitar com 403 ou redirecionar.

> Referência de design: *Estrutura de pastas → app/(app)/kb*, *Data Models → kbArticles*.

### Requirement 14: Administração de usuários

**User Story:** Como Admin, eu quero criar, ativar/desativar e atualizar usuários, para gerenciar o acesso ao NaveDesk.

#### Acceptance Criteria

1. WHEN um Admin acessa `/admin/usuarios`, THE NaveDesk_Sistema SHALL listar todos os usuários com `name`, `email`, `role`, `departmentId`, `active`.
2. WHEN um Admin cria um usuário com `email`, `name`, `role`, `departmentId`, senha temporária, THE Servico_Admin SHALL armazenar `passwordHash` calculado com `bcrypt(cost=12)`.
3. IF o e-mail já existe em `users`, THEN THE Servico_Admin SHALL rejeitar a criação retornando erro de conflito.
4. WHEN um Admin desativa um usuário, THE Servico_Admin SHALL definir `active=false` sem apagar o registro.
5. WHILE um usuário tem `active=false`, THE Servico_Auth SHALL impedir login bem-sucedido.
6. WHEN um Admin altera o papel de um usuário, THE Servico_Admin SHALL persistir o novo `role` e invalidar a sessão atual do usuário alvo na próxima requisição.
7. THE Servico_Admin SHALL logar (em `ticket_events` quando aplicável a ticket, ou em log estruturado) toda alteração administrativa relevante.

> Referência de design: *Components and Interfaces → admin actions*, *Considerações de Segurança → Senhas*.

### Requirement 15: Administração de políticas de SLA e categorias

**User Story:** Como Admin, eu quero ajustar as horas de cada prioridade e gerenciar as categorias de chamado, para adequar o NaveDesk à realidade da operação.

#### Acceptance Criteria

1. WHEN um Admin acessa `/admin/sla`, THE NaveDesk_Sistema SHALL listar a Politica_SLA atual para cada prioridade.
2. WHEN um Admin atualiza as horas de uma prioridade, THE Servico_Admin SHALL aceitar somente inteiros `> 0` e persistir em `sla_policies`.
3. WHEN a Politica_SLA é atualizada, THE Servico_Admin SHALL invalidar o cache de leituras de políticas (TTL 60s) imediatamente.
4. WHEN um Admin acessa `/admin/categorias`, THE NaveDesk_Sistema SHALL listar todas as Categorias com `id`, `label`, `sub`, `icon`, `active`.
5. WHEN um Admin cria uma nova Categoria, THE Servico_Admin SHALL exigir `id` único, `label`, `sub`, `icon` e padronizar `active=true`.
6. WHEN um Admin marca uma Categoria como `active=false`, THE NaveDesk_Sistema SHALL ocultá-la em formulários de criação de ticket, sem afetar tickets existentes que a referenciam.
7. IF um Admin tenta excluir uma Categoria com tickets associados, THEN THE Servico_Admin SHALL rejeitar a exclusão e sugerir desativação.

> Referência de design: *Data Models → categories, sla_policies*, *Considerações de Performance → Cache de leituras estáveis*.

### Requirement 16: Trilha de auditoria

**User Story:** Como Admin, eu quero rastrear todas as mudanças relevantes em um ticket, para investigar incidentes e responsabilizar ações.

#### Acceptance Criteria

1. WHEN um ticket é criado, THE Servico_Tickets SHALL gravar um evento `created` em `ticket_events`.
2. WHEN o status de um ticket muda, THE Servico_Tickets SHALL gravar um evento `status_changed` com `fromValue` e `toValue`.
3. WHEN a prioridade de um ticket muda, THE Servico_Tickets SHALL gravar um evento `priority_changed` com `fromValue` e `toValue`.
4. WHEN a atribuição é definida ou alterada, THE Servico_Tickets SHALL gravar um evento `assigned`.
5. WHEN a atribuição é removida, THE Servico_Tickets SHALL gravar um evento `unassigned`.
6. WHEN o Solicitante avalia um ticket, THE Servico_Tickets SHALL gravar um evento `rated` com `toValue` igual à nota.
7. WHEN um ticket é fechado, THE Servico_Tickets SHALL gravar um evento `closed`.
8. THE Trilha_Auditoria SHALL armazenar `actorId`, `type`, `fromValue`, `toValue`, `createdAt` para cada evento e SHALL ser imutável (apenas operações INSERT são aceitas).
9. THE NaveDesk_Sistema SHALL exibir o histórico do ticket cronologicamente no detalhe.

> Referência de design: *Data Models → ticket_events*, *Decisões Arquiteturais → eventos como tabela própria*.

### Requirement 17: Persistência via PostgreSQL e Drizzle

**User Story:** Como desenvolvedor, eu quero que o esquema do banco seja gerenciado por código com migrations versionadas, para que o estado do banco seja reprodutível.

#### Acceptance Criteria

1. THE NaveDesk_Sistema SHALL persistir todos os dados em PostgreSQL 16 usando Drizzle ORM.
2. THE NaveDesk_Sistema SHALL armazenar migrations em `src/db/migrations/` geradas por Drizzle Kit a partir de `src/db/schema.ts`.
3. WHEN o serviço `app` inicia no Docker Compose, THE NaveDesk_Sistema SHALL executar `pnpm db:migrate` antes do servidor HTTP estar disponível.
4. THE script `pnpm db:migrate` SHALL ser idempotente: aplicar somente migrations pendentes e não falhar se já estiver atualizado.
5. THE NaveDesk_Sistema SHALL usar prepared statements em todas as consultas (garantido pelo Drizzle), eliminando vetor de SQL injection.
6. THE NaveDesk_Sistema SHALL criar índices em `tickets(status)`, `tickets(assignee_id)`, `tickets(requester_id)`, `tickets(sla_deadline)`, `ticket_messages(ticket_id, created_at)` e `ticket_events(ticket_id, created_at)`.

> Referência de design: *Data Models*, *Considerações de Performance*, *Considerações de Segurança → SQL injection*.

### Requirement 18: Bootstrap via Docker Compose com seed idempotente

**User Story:** Como engenheiro, eu quero clonar o repositório em qualquer máquina e subir o sistema com um único comando, para minimizar o atrito de setup.

#### Acceptance Criteria

1. WHEN um usuário executa `docker compose up --build` em uma máquina limpa após clonar o repositório e copiar `.env.example` para `.env`, THE Bootstrap_Compose SHALL subir o serviço `db` (Postgres 16), aguardar o healthcheck `pg_isready`, executar migrations, executar o Seed_Idempotente e iniciar o servidor Next.js.
2. THE NaveDesk_Sistema SHALL expor a aplicação em `http://localhost:3000` após o bootstrap completo.
3. THE Bootstrap_Compose SHALL usar volumes nomeados `pgdata` (dados do banco) e `uploads` (arquivos enviados) para preservar estado entre subidas.
4. THE NaveDesk_Sistema SHALL versionar `.env.example` no repositório com as chaves `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `UPLOAD_DIR`, `UPLOAD_MAX_BYTES`.
5. THE NaveDesk_Sistema SHALL manter `.env` listado em `.gitignore`.
6. WHEN o Seed_Idempotente é executado e a tabela `users` está vazia, THE Servico_Admin SHALL popular categorias, departamentos, políticas SLA e três usuários de exemplo (admin, técnico, solicitante).
7. WHEN o Seed_Idempotente é executado e a tabela `users` não está vazia, THE Servico_Admin SHALL não modificar nenhum dado existente.
8. THE README.md SHALL conter instruções para subir o sistema em outra máquina em no máximo quatro comandos (`git clone`, `cp .env.example .env`, ajuste opcional de `.env`, `docker compose up --build`).
9. THE Dockerfile SHALL produzir uma imagem multi-stage (`deps`, `builder`, `runner`) baseada em `node:20-alpine` com saída `standalone` do Next.js.

> Referência de design: *Infraestrutura: Docker & Postgres*.

### Requirement 19: Fundação de design tokens e componentes reutilizáveis

**User Story:** Como desenvolvedor frontend, eu quero uma fundação de tokens e componentes consistente, para que toda a UI use a mesma paleta, tipografia e primitivos.

#### Acceptance Criteria

1. THE NaveDesk_Sistema SHALL definir tokens visuais (paleta, raios, sombras, tipografia) como CSS custom properties em `src/styles/tokens.css`.
2. THE NaveDesk_Sistema SHALL exportar um espelho desses tokens em TypeScript em `src/lib/design-tokens.ts` para uso em componentes.
3. THE NaveDesk_Sistema SHALL fornecer primitivos de UI em `src/components/ui/` incluindo no mínimo: `button`, `input`, `select`, `textarea`, `badge`, `card`, `dialog`, `dropdown`, `tabs`, `toast`, `avatar`, `data-table`, `empty-state`.
4. THE NaveDesk_Sistema SHALL fornecer componentes de domínio em `src/components/domain/` incluindo no mínimo: `status-badge`, `priority-pill`, `category-chip`, `sla-meter`, `kpi-card`, `ticket-row`, `ticket-conversation`, `ticket-history`, `ticket-form`, `attachment-chip`.
5. THE componente `StatusBadge` SHALL mapear cada status a um tom: `aberto→blue`, `andamento→amber`, `aguardando→grey`, `resolvido→green`, `fechado→grey`.
6. THE componente `PriorityPill` SHALL mapear cada prioridade a um tom: `baixa→grey`, `media→blue`, `alta→amber`, `critica→red`.
7. THE NaveDesk_Sistema SHALL garantir que componentes de domínio não realizem fetch direto: recebem dados via props para serem compatíveis com Server Components.
8. THE NaveDesk_Sistema SHALL aplicar `class-variance-authority` para variantes de componentes e `tailwind-merge` para resolução de classes Tailwind.

> Referência de design: *Components and Interfaces*, *Tokens de Design*, *Decisões Arquiteturais → shadcn/ui-style*.

### Requirement 20: Idioma pt-BR como padrão do produto

**User Story:** Como colaborador da Contábil Andrade, eu quero o sistema todo em português brasileiro, para usar o NaveDesk sem barreira de idioma.

#### Acceptance Criteria

1. THE NaveDesk_Sistema SHALL exibir todos os textos de interface (rótulos, mensagens, erros, e-mails transacionais) em português brasileiro (pt-BR).
2. THE NaveDesk_Sistema SHALL configurar o atributo `lang="pt-BR"` no elemento `<html>` raiz.
3. WHEN datas e durações são apresentadas, THE NaveDesk_Sistema SHALL formatá-las com locale `pt-BR` (via `date-fns/locale/pt-BR`), incluindo nomes de mês, dias da semana e tempo relativo.
4. THE NaveDesk_Sistema SHALL utilizar como rótulos de status, prioridade e categoria os termos em pt-BR (ex.: `Aberto`, `Em andamento`, `Aguardando solicitante`, `Resolvido`, `Fechado`; `Baixa`, `Média`, `Alta`, `Crítica`).

> Referência de design: *Overview*, *Dependências → date-fns locale pt-BR*.

### Requirement 21: Identidade visual (paleta índigo e tipografia Geist)

**User Story:** Como gestor do produto, eu quero que a identidade visual do NaveDesk siga as mockups aprovadas, para preservar a coerência da marca interna.

#### Acceptance Criteria

1. THE NaveDesk_Sistema SHALL usar `#5E5CE6` como cor de acento primária, exposta via token CSS `--accent`.
2. THE NaveDesk_Sistema SHALL usar a família tipográfica `Geist` para texto principal (`--font`) e `Geist Mono` para conteúdo monoespaçado (`--font-mono`).
3. WHEN o Geist não estiver disponível, THE NaveDesk_Sistema SHALL fazer fallback para `ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif` (e equivalentes monoespaçadas para mono).
4. THE NaveDesk_Sistema SHALL usar a paleta de status definida pelos tokens `--green`, `--amber`, `--red`, `--blue` e variantes `*-soft` exclusivamente para representar estados de domínio (status, prioridade, alertas).
5. THE NaveDesk_Sistema SHALL aplicar os raios `--r-1` a `--r-5` e `--r-pill` definidos nos tokens em todos os primitivos de UI.

> Referência de design: *Tokens de Design → tokens.css*, *Components and Interfaces*.

### Requirement 22: Tratamento e robustez de erros

**User Story:** Como usuário, eu quero mensagens de erro claras e que o sistema não exponha detalhes técnicos sensíveis, para manter confiança e segurança.

#### Acceptance Criteria

1. WHEN uma Server Action ou Route Handler captura uma falha de validação Zod, THE NaveDesk_Sistema SHALL retornar `ActionResult.error` com `code` específico e `field` apontando o campo inválido, sem expor stack trace.
2. IF a Maquina_Estados rejeita uma transição, THEN THE Servico_Tickets SHALL retornar `ActionResult.error.code="ILLEGAL_TRANSITION"` com mensagem amigável.
3. IF o RBAC nega uma operação, THEN THE NaveDesk_Sistema SHALL retornar `ActionResult.error.code="FORBIDDEN"`.
4. IF o Servico_Upload recebe arquivo acima do limite ou com MIME inválido, THEN THE NaveDesk_Sistema SHALL responder com 413 (tamanho) ou 415 (tipo) e mensagem em pt-BR.
5. WHEN o Postgres está indisponível, THE NaveDesk_Sistema SHALL responder com 500 genérico ao usuário e registrar log estruturado contendo correlação de requisição.
6. IF um anexo solicitado não existe ou o usuário não tem permissão, THEN THE Servico_Download SHALL responder com 404 sem distinguir os dois casos.
7. WHILE o ticket está com SLA estourado (`level="breached"`), THE NaveDesk_Sistema SHALL marcar visualmente o ticket em vermelho mas SHALL NOT bloquear novas operações de mensagem, atribuição ou mudança de status.

> Referência de design: *Error Handling*.
