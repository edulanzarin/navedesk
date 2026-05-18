// NaveDesk — components & icons
/* global React */

// ── icons (24px viewBox, 1.5px stroke) ──────────────────────
const Ic = {
    dashboard: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
            <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
            <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
            <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
        </svg>
    ),
    tickets: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 7.5C4 6.67 4.67 6 5.5 6h13c.83 0 1.5.67 1.5 1.5V10a2 2 0 0 0 0 4v2.5c0 .83-.67 1.5-1.5 1.5h-13C4.67 18 4 17.33 4 16.5V14a2 2 0 0 0 0-4V7.5z" />
            <path d="M10 6v12" strokeDasharray="2 2" />
        </svg>
    ),
    plus: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
        >
            <path d="M12 5v14M5 12h14" />
        </svg>
    ),
    book: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2V5z" />
            <path d="M4 18v1a2 2 0 0 0 2 2h12" />
        </svg>
    ),
    user: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
        </svg>
    ),
    cog: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 3v2.5M12 18.5V21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M3 12h2.5M18.5 12H21M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
        </svg>
    ),
    search: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-4.3-4.3" />
        </svg>
    ),
    bell: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
    ),
    filter: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 5h16M7 12h10M10 19h4" />
        </svg>
    ),
    chevDown: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m6 9 6 6 6-6" />
        </svg>
    ),
    chevLeft: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m15 6-6 6 6 6" />
        </svg>
    ),
    chevRight: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m9 6 6 6-6 6" />
        </svg>
    ),
    arrowUp: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
    ),
    arrowDown: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
    ),
    check: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12.5 10 17.5 19.5 7" />
        </svg>
    ),
    paperclip: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m20 12-7.5 7.5a4.5 4.5 0 0 1-6.4-6.4l8.5-8.5a3 3 0 0 1 4.2 4.2l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1L15.5 8" />
        </svg>
    ),
    send: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m4 12 16-8-7 16-2-6-7-2z" />
        </svg>
    ),
    star: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="m12 3.5 2.7 5.7 6.3.8-4.6 4.4 1.2 6.2L12 17.7 6.4 20.6l1.2-6.2L3 10l6.3-.8L12 3.5z" />
        </svg>
    ),
    starOutline: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        >
            <path d="m12 3.5 2.7 5.7 6.3.8-4.6 4.4 1.2 6.2L12 17.7 6.4 20.6l1.2-6.2L3 10l6.3-.8L12 3.5z" />
        </svg>
    ),
    monitor: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
        </svg>
    ),
    app: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
    ),
    key: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="8" cy="15" r="4" />
            <path d="m11 12 9-9M16 7l2 2" />
        </svg>
    ),
    mail: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
        </svg>
    ),
    calc: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0" />
        </svg>
    ),
    wifi: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M2 9.5a15 15 0 0 1 20 0M5.5 13a10 10 0 0 1 13 0M9 16.5a5 5 0 0 1 6 0" />
            <circle cx="12" cy="20" r="1" fill="currentColor" />
        </svg>
    ),
    box: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9z" />
            <path d="M3 7.5 12 12l9-4.5M12 12v9" />
        </svg>
    ),
    clock: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    ),
    file: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
            <path d="M14 3v5h5" />
        </svg>
    ),
    logout: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
            <path d="M9 12h12m0 0-4-4m4 4-4 4" />
        </svg>
    ),
    edit: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 20h4l10-10-4-4L4 16v4z" />
            <path d="m14 6 4 4" />
        </svg>
    ),
    trash: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M4 7h16M9 7V4h6v3M6 7v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
        </svg>
    ),
    refresh: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
        </svg>
    ),
    more: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="6" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="18" cy="12" r="1.5" />
        </svg>
    ),
    alert: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 9v4M12 17h0" />
            <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
    ),
    inbox: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 13.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5.5" />
            <path d="M3 13.5 6 4h12l3 9.5" />
            <path d="M3 13.5h5l1.5 2.5h5L16 13.5h5" />
        </svg>
    ),
    brand: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 13.5 12 6l7 7.5" />
            <path d="M8 11v6a1 1 0 0 0 1 1h2.5v-4h1V18H15a1 1 0 0 0 1-1v-6" />
        </svg>
    ),
    zap: (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7z" />
        </svg>
    ),
};

// ── Avatar ─────────────────────────────────────────────────
function Avatar({ user, size = "md" }) {
    if (!user)
        return (
            <div className={`av av-${size}`} style={{ background: "#c4c4cc" }}>
                ?
            </div>
        );
    const initials = user.name
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    const cls =
        size === "sm" ? "av av-sm" : size === "lg" ? "av av-lg" : size === "xl" ? "av av-xl" : "av";
    return (
        <div className={cls} style={{ background: user.color }}>
            {initials}
        </div>
    );
}

// ── Priority pill ──────────────────────────────────────────
function PrioPill({ id }) {
    const p = PRIORITIES.find((p) => p.id === id);
    return (
        <span className={`prio prio-${id}`}>
            <span className="prio-dot" />
            {p.label}
        </span>
    );
}

// ── Status badge ───────────────────────────────────────────
function StatusBadge({ id }) {
    const s = STATUSES.find((s) => s.id === id);
    return <span className={`badge badge-${s.badge}`}>{s.label}</span>;
}

// ── Category chip ──────────────────────────────────────────
function CatChip({ id }) {
    const c = CATEGORIES.find((c) => c.id === id);
    return (
        <span className="cat-chip">
            <span className="cat-chip-ic">{Ic[c.icon]}</span>
            <span>{c.label}</span>
        </span>
    );
}

// ── relative time ──────────────────────────────────────────
function relTime(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "agora";
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function fmtDate(iso) {
    return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function fmtDuration(mins) {
    if (!mins) return "0min";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
}

// SLA: countdown to deadline
function slaInfo(deadlineIso) {
    const ms = new Date(deadlineIso).getTime() - Date.now();
    const past = ms < 0;
    const total = Math.abs(ms);
    const h = Math.floor(total / 3600000);
    const m = Math.floor((total % 3600000) / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const label = past
        ? `-${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    let level = "ok";
    if (past) level = "crit";
    else if (h < 1) level = "crit";
    else if (h < 4) level = "warn";
    return { label, level, past, h, m };
}

// ── Sidebar ────────────────────────────────────────────────
function Sidebar({ page, setPage, user, tickets, setRole }) {
    const counts = React.useMemo(() => {
        const myOpen = tickets.filter(
            (t) =>
                t.status !== "fechado" &&
                t.status !== "resolvido" &&
                (user.role === "solicitante" ? t.requester === user.id : true),
        );
        const assigned = tickets.filter(
            (t) => t.assignee === user.id && t.status !== "fechado" && t.status !== "resolvido",
        );
        const unassigned = tickets.filter((t) => !t.assignee && t.status === "aberto");
        return { open: myOpen.length, assigned: assigned.length, unassigned: unassigned.length };
    }, [tickets, user]);

    const isTech = user.role === "tecnico" || user.role === "admin";
    const Item = ({ id, icon, label, count }) => (
        <button className={`rail-item ${page === id ? "active" : ""}`} onClick={() => setPage(id)}>
            {Ic[icon]}
            <span>{label}</span>
            {count != null && count > 0 && <span className="rail-count">{count}</span>}
        </button>
    );

    return (
        <aside className="rail">
            <div className="rail-brand">
                <div className="brand-mark">{Ic.brand}</div>
                <div>
                    <div className="brand-name">NaveDesk</div>
                    <div className="brand-sub">Contábil Andrade</div>
                </div>
            </div>

            <Item id="dashboard" icon="dashboard" label="Dashboard" />
            <Item
                id="tickets"
                icon="tickets"
                label={isTech ? "Todos os tickets" : "Meus tickets"}
                count={isTech ? counts.unassigned : counts.open}
            />
            {isTech && (
                <Item
                    id="atribuidos"
                    icon="inbox"
                    label="Atribuídos a mim"
                    count={counts.assigned}
                />
            )}
            <Item id="novo" icon="plus" label="Novo ticket" />
            <Item id="faq" icon="book" label="Base de conhecimento" />

            {user.role === "admin" && (
                <>
                    <div className="rail-section">Administração</div>
                    <Item id="admin" icon="cog" label="Configurações" />
                </>
            )}

            <div className="rail-foot">
                <div className="rail-user" onClick={() => setPage("perfil")}>
                    <Avatar user={user} size="sm" />
                    <div>
                        <div className="rail-user-name">{user.name}</div>
                        <div className="rail-user-role">
                            {user.role === "admin"
                                ? "Administrador"
                                : user.role === "tecnico"
                                  ? "Técnico TI"
                                  : user.dept}
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
}

// ── Topbar ────────────────────────────────────────────────
function Topbar({ title, sub, right }) {
    return (
        <div className="topbar">
            <div>
                <h1>{title}</h1>
                {sub && <div className="topbar-sub">{sub}</div>}
            </div>
            <div className="topbar-spacer" />
            <div className="search">
                {Ic.search}
                <input placeholder="Buscar tickets, pessoas, artigos…" />
                <span className="kbd">⌘K</span>
            </div>
            <button
                className="btn btn-icon btn-ghost"
                title="Notificações"
                style={{ position: "relative" }}
            >
                {Ic.bell}
                <span
                    style={{
                        position: "absolute",
                        top: 5,
                        right: 5,
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--red)",
                        boxShadow: "0 0 0 1.5px #fff",
                    }}
                />
            </button>
            {right}
        </div>
    );
}

Object.assign(window, {
    Ic,
    Avatar,
    PrioPill,
    StatusBadge,
    CatChip,
    relTime,
    fmtDate,
    fmtDuration,
    slaInfo,
    Sidebar,
    Topbar,
});
