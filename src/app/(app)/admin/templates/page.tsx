/**
 * Página `/admin/templates` (Server Component).
 *
 * Admin gerencia os modelos pré-preenchidos que aparecem na tela de
 * abertura de tickets. Carrega categorias, departamentos e a lista
 * atual de templates e delega o CRUD ao Client Component.
 */

import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/db/client";
import { listAllTemplates } from "@/db/repositories/ticket-templates.repo";
import { auth } from "@/lib/auth";
import { canManageCategories } from "@/lib/policies";
import { listCategories, listDepartments } from "@/services/reads.service";
import type { SessionUser } from "@/types/domain";

import { TemplatesManagement } from "./templates-management";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
    const session = await auth();
    if (!session?.user) redirect("/login");
    const actor = session.user satisfies SessionUser;
    if (!canManageCategories(actor)) redirect("/dashboard");

    const [templates, categories, departments] = await Promise.all([
        listAllTemplates(db),
        listCategories(),
        listDepartments(),
    ]);

    return (
        <div>
            <PageHeader
                title="Modelos de ticket"
                description="Atalhos pré-preenchidos para abertura rápida"
            />
            <TemplatesManagement
                templates={templates.map((t) => ({
                    id: t.id,
                    name: t.name,
                    title: t.title,
                    description: t.description,
                    priority: t.priority,
                    categoryId: t.categoryId,
                    departmentId: t.departmentId,
                    active: t.active,
                }))}
                categories={categories
                    .filter((c) => c.active)
                    .map((c) => ({ id: c.id, label: c.label }))}
                departments={departments.map((d) => ({
                    id: d.id,
                    name: d.name,
                }))}
            />
        </div>
    );
}
