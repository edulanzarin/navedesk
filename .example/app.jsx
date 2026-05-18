// NaveDesk — main app
/* global React, ReactDOM, TICKETS, USERS, userById,
   LoginScreen, DashboardScreen, TicketsList, NewTicket, TicketDetail,
   ProfileScreen, AdminScreen, FAQScreen,
   Sidebar, Topbar, useTweaks, TweaksPanel, TweakSection,
   TweakColor, TweakRadio, TweakSelect, TweakSlider */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
    accent: "#5E5CE6",
    density: "regular",
    glass: "subtle",
    viewAs: "admin",
}; /*EDITMODE-END*/

function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [userId, setUserId] = React.useState(null);
    const [page, setPage] = React.useState("dashboard");
    const [openTicketId, setOpenTicketId] = React.useState(null);
    const [tickets, setTickets] = React.useState(TICKETS);

    // apply tweak vars to root
    React.useEffect(() => {
        const r = document.documentElement;
        r.style.setProperty("--accent", t.accent);
        r.style.setProperty("--accent-soft", t.accent + "1f"); // 12% alpha
        r.style.setProperty("--accent-soft-2", t.accent + "0f"); // 6% alpha
        r.dataset.density = t.density;
        r.dataset.glass = t.glass;
    }, [t.accent, t.density, t.glass]);

    // sync viewAs role with login user
    React.useEffect(() => {
        if (!userId) return;
        const u = userById(userId);
        if (u && u.role !== t.viewAs) {
            // user switched role via tweak → switch user
            const newU = USERS.find((x) => x.role === t.viewAs);
            if (newU) setUserId(newU.id);
        }
    }, [t.viewAs]);

    // ⌘K handler — focus search bar
    React.useEffect(() => {
        const h = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                document.querySelector(".search input")?.focus();
            }
            if (e.key === "Escape" && openTicketId) {
                setOpenTicketId(null);
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [openTicketId]);

    const user = userId ? userById(userId) : null;
    const openTicket = openTicketId ? tickets.find((x) => x.id === openTicketId) : null;

    const handleLogin = (uid) => {
        setUserId(uid);
        const u = userById(uid);
        setTweak("viewAs", u.role);
    };

    const handleLogout = () => {
        setUserId(null);
        setPage("dashboard");
        setOpenTicketId(null);
    };

    const openTicketDetail = (id) => {
        setOpenTicketId(id);
    };

    const updateTicket = (updated) => {
        setTickets(tickets.map((x) => (x.id === updated.id ? updated : x)));
    };

    const createTicket = (data) => {
        const id = "NVD-" + (1043 + tickets.length - 12);
        const slaHours = { critica: 2, alta: 8, media: 24, baixa: 48 }[data.priority];
        const newT = {
            id,
            ...data,
            status: "aberto",
            requester: user.id,
            assignee: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            slaDeadline: new Date(Date.now() + slaHours * 3600000).toISOString(),
            timeSpent: 0,
            attachments: data.attachments || [],
            conversation: [
                {
                    id: "m1",
                    author: user.id,
                    time: new Date().toISOString(),
                    body: data.description,
                    attachments: data.attachments,
                },
            ],
            history: [{ type: "created", time: new Date().toISOString(), by: user.id }],
        };
        setTickets([newT, ...tickets]);
        setPage("tickets");
        setTimeout(() => setOpenTicketId(newT.id), 50);
    };

    if (!user) {
        return (
            <>
                <LoginScreen onLogin={handleLogin} />
                <TweaksPanel title="Tweaks">
                    <TweakColor
                        label="Cor de destaque"
                        value={t.accent}
                        options={["#5E5CE6", "#0A84FF", "#30B257", "#D98C00", "#BF5AF2"]}
                        onChange={(v) => setTweak("accent", v)}
                    />
                    <TweakRadio
                        label="Densidade"
                        value={t.density}
                        options={[
                            { value: "compact", label: "Compacto" },
                            { value: "regular", label: "Padrão" },
                            { value: "comfy", label: "Amplo" },
                        ]}
                        onChange={(v) => setTweak("density", v)}
                    />
                    <TweakSelect
                        label="Intensidade glass"
                        value={t.glass}
                        options={[
                            { value: "subtle", label: "Sutil" },
                            { value: "medium", label: "Médio" },
                            { value: "intense", label: "Intenso" },
                        ]}
                        onChange={(v) => setTweak("glass", v)}
                    />
                    <TweakSection label="Visualizar como" />
                    <TweakRadio
                        label="Papel"
                        value={t.viewAs}
                        options={[
                            { value: "solicitante", label: "Solic." },
                            { value: "tecnico", label: "Técnico" },
                            { value: "admin", label: "Admin" },
                        ]}
                        onChange={(v) => setTweak("viewAs", v)}
                    />
                </TweaksPanel>
            </>
        );
    }

    // page title map
    const pageTitle = () => {
        if (openTicket)
            return { title: openTicket.title, sub: `${openTicket.id} · ${openTicket.department}` };
        if (page === "dashboard") return { title: "Dashboard", sub: "Visão geral do helpdesk" };
        if (page === "tickets")
            return {
                title: user.role === "solicitante" ? "Meus tickets" : "Tickets",
                sub: "Chamados de TI",
            };
        if (page === "atribuidos")
            return { title: "Atribuídos a mim", sub: "Chamados sob sua responsabilidade" };
        if (page === "novo") return { title: "Novo ticket", sub: "Abrir um chamado" };
        if (page === "faq")
            return { title: "Base de conhecimento", sub: "Soluções para problemas comuns" };
        if (page === "perfil") return { title: "Perfil", sub: user.email };
        if (page === "admin") return { title: "Configurações", sub: "Administração do sistema" };
        return { title: "", sub: "" };
    };
    const pt = pageTitle();

    return (
        <>
            <div className="app-bg" />
            <div className="app" data-screen-label="app">
                <Sidebar
                    page={page}
                    setPage={(p) => {
                        setPage(p);
                        setOpenTicketId(null);
                    }}
                    user={user}
                    tickets={tickets}
                />
                <div
                    className="main"
                    data-screen-label={openTicket ? `ticket-${openTicket.id}` : page}
                >
                    <Topbar
                        title={pt.title}
                        sub={pt.sub}
                        right={
                            <button
                                className="btn btn-ghost btn-icon"
                                onClick={handleLogout}
                                title="Sair"
                            >
                                {window.Ic.logout}
                            </button>
                        }
                    />
                    <div className="content">
                        {openTicket ? (
                            <TicketDetail
                                ticket={openTicket}
                                user={user}
                                onUpdate={updateTicket}
                                onBack={() => setOpenTicketId(null)}
                            />
                        ) : page === "dashboard" ? (
                            <DashboardScreen
                                tickets={tickets}
                                user={user}
                                onOpen={openTicketDetail}
                            />
                        ) : page === "tickets" ? (
                            <TicketsList
                                tickets={tickets}
                                user={user}
                                onOpen={openTicketDetail}
                                page={page}
                            />
                        ) : page === "atribuidos" ? (
                            <TicketsList
                                tickets={tickets}
                                user={user}
                                onOpen={openTicketDetail}
                                page={page}
                            />
                        ) : page === "novo" ? (
                            <NewTicket
                                user={user}
                                onCreate={createTicket}
                                onCancel={() => setPage("dashboard")}
                            />
                        ) : page === "faq" ? (
                            <FAQScreen />
                        ) : page === "perfil" ? (
                            <ProfileScreen user={user} tickets={tickets} />
                        ) : page === "admin" ? (
                            <AdminScreen />
                        ) : null}
                    </div>
                </div>
            </div>

            <TweaksPanel title="Tweaks">
                <TweakColor
                    label="Cor de destaque"
                    value={t.accent}
                    options={["#5E5CE6", "#0A84FF", "#30B257", "#D98C00", "#BF5AF2"]}
                    onChange={(v) => setTweak("accent", v)}
                />
                <TweakRadio
                    label="Densidade"
                    value={t.density}
                    options={[
                        { value: "compact", label: "Compacto" },
                        { value: "regular", label: "Padrão" },
                        { value: "comfy", label: "Amplo" },
                    ]}
                    onChange={(v) => setTweak("density", v)}
                />
                <TweakSelect
                    label="Intensidade glass"
                    value={t.glass}
                    options={[
                        { value: "subtle", label: "Sutil" },
                        { value: "medium", label: "Médio" },
                        { value: "intense", label: "Intenso" },
                    ]}
                    onChange={(v) => setTweak("glass", v)}
                />
                <TweakSection label="Visualizar como" />
                <TweakRadio
                    label="Papel"
                    value={t.viewAs}
                    options={[
                        { value: "solicitante", label: "Solic." },
                        { value: "tecnico", label: "Técnico" },
                        { value: "admin", label: "Admin" },
                    ]}
                    onChange={(v) => setTweak("viewAs", v)}
                />
            </TweaksPanel>
        </>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
