-- Manual migration: templates de ticket.
--
-- Admins definem modelos pré-preenchidos ("Reset de senha", "Configurar
-- VPN", "Instalar Office") com título, descrição-base, prioridade e
-- categoria sugeridas. Solicitantes escolhem um template ao abrir um
-- ticket e os campos chegam preenchidos no formulário.
--
-- A descrição é texto multi-linha; a UI permite o solicitante editar
-- antes de submeter — o template é só atalho, não constraint.

CREATE TABLE IF NOT EXISTS ticket_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    title           text NOT NULL,
    description     text NOT NULL,
    priority        priority NOT NULL DEFAULT 'media',
    category_id     text NOT NULL REFERENCES categories(id),
    department_id   uuid REFERENCES departments(id),
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_templates_active_idx
    ON ticket_templates (active, name);
