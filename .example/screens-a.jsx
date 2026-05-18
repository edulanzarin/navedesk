// NaveDesk — screens part 1: Login, Dashboard, TicketsList, NewTicket
/* global React, Ic, Avatar, PrioPill, StatusBadge, CatChip, relTime, fmtDuration, slaInfo, USERS, CATEGORIES, DEPARTMENTS, PRIORITIES, STATUSES, TICKETS */

// ── Login ────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
    const [email, setEmail] = React.useState("marina.andrade@contabilandrade.com.br");
    const [pwd, setPwd] = React.useState("••••••••••");
    const [role, setRole] = React.useState("admin");
    const [loading, setLoading] = React.useState(false);

    const presets = {
        solicitante: { user: "u4", email: "camila.borges@contabilandrade.com.br" },
        tecnico: { user: "u2", email: "rafael.couto@contabilandrade.com.br" },
        admin: { user: "u1", email: "marina.andrade@contabilandrade.com.br" },
    };

    const choose = (r) => {
        setRole(r);
        setEmail(presets[r].email);
    };

    const submit = (e) => {
        e?.preventDefault();
        setLoading(true);
        setTimeout(() => {
            onLogin(presets[role].user);
        }, 500);
    };

    return (
        <div className="login-wrap">
            <form className="login-card" onSubmit={submit}>
                <div className="login-brand">
                    <div className="brand-mark" style={{ width: 38, height: 38, borderRadius: 11 }}>
                        {Ic.brand}
                    </div>
                    <div>
                        <div className="login-h1">NaveDesk</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                            Central de TI — Contábil Andrade
                        </div>
                    </div>
                </div>

                <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginBottom: 18 }}>
                    Acesse com sua conta corporativa para abrir e acompanhar chamados.
                </div>

                <div className="login-roles">
                    <button
                        type="button"
                        className={role === "solicitante" ? "on" : ""}
                        onClick={() => choose("solicitante")}
                    >
                        Solicitante
                    </button>
                    <button
                        type="button"
                        className={role === "tecnico" ? "on" : ""}
                        onClick={() => choose("tecnico")}
                    >
                        Técnico TI
                    </button>
                    <button
                        type="button"
                        className={role === "admin" ? "on" : ""}
                        onClick={() => choose("admin")}
                    >
                        Admin
                    </button>
                </div>

                <div className="field">
                    <label className="label">E-mail corporativo</label>
                    <input
                        className="input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>

                <div className="field">
                    <label className="label">Senha</label>
                    <input
                        className="input"
                        type="password"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                    />
                </div>

                <button
                    className="btn btn-primary btn-lg"
                    style={{ width: "100%", marginTop: 4 }}
                    type="submit"
                    disabled={loading}
                >
                    {loading ? "Entrando…" : "Entrar"}
                </button>

                <div className="login-foot">
                    <a href="#">Esqueci minha senha</a>
                    <span>v 2.4 · pt-BR</span>
                </div>
            </form>
        </div>
    );
}

// ── Dashboard ────────────────────────────────────────────
function Sparkline({ data, color }) {
    const w = 56,
        h = 30,
        max = Math.max(...data),
        min = Math.min(...data);
    const path = data
        .map((v, i) => {
            const x = (i / (data.length - 1)) * w;
            const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
    return (
        <svg className="stat-spark" viewBox={`0 0 ${w} ${h}`}>
            <path
                d={path}
                stroke={color}
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} opacity="0.08" />
        </svg>
    );
}

function CatDistribution({ tickets }) {
    const counts = React.useMemo(() => {
        const c = {};
        tickets.forEach((t) => {
            c[t.category] = (c[t.category] || 0) + 1;
        });
        return c;
    }, [tickets]);
    const total = tickets.length || 1;
    const sorted = CATEGORIES.map((c) => ({ ...c, count: counts[c.id] || 0 })).sort(
        (a, b) => b.count - a.count,
    );

    return (
        <div className="card">
            <div className="card-hd">
                <h3>Tickets por categoria</h3>
                <span className="card-hd-sub">{tickets.length} no total</span>
            </div>
            <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sorted.map((c) => (
                    <div key={c.id}>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
                            <CatChip id={c.id} />
                            <span
                                style={{
                                    marginLeft: "auto",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: "var(--ink-2)",
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            >
                                {c.count}
                            </span>
                        </div>
                        <div className="bar">
                            <div style={{ width: `${(c.count / total) * 100}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PrioDistribution({ tickets }) {
    const counts = {};
    tickets.forEach((t) => {
        counts[t.priority] = (counts[t.priority] || 0) + 1;
    });
    const total = tickets.length || 1;
    const segments = PRIORITIES.map((p) => ({
        ...p,
        count: counts[p.id] || 0,
        color:
            p.id === "critica"
                ? "var(--red)"
                : p.id === "alta"
                  ? "var(--amber)"
                  : p.id === "media"
                    ? "var(--blue)"
                    : "#8a8a93",
    }));

    return (
        <div className="card">
            <div className="card-hd">
                <h3>Por prioridade</h3>
            </div>
            <div className="card-pad">
                <div
                    style={{
                        display: "flex",
                        height: 8,
                        borderRadius: 4,
                        overflow: "hidden",
                        gap: 2,
                        marginBottom: 16,
                    }}
                >
                    {segments.map(
                        (s) =>
                            s.count > 0 && (
                                <div
                                    key={s.id}
                                    style={{
                                        width: `${(s.count / total) * 100}%`,
                                        background: s.color,
                                        minWidth: 4,
                                    }}
                                />
                            ),
                    )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {segments.map((s) => (
                        <div
                            key={s.id}
                            style={{ display: "flex", alignItems: "center", fontSize: 13 }}
                        >
                            <span
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: s.color,
                                    marginRight: 8,
                                }}
                            />
                            <span style={{ color: "var(--ink-2)", fontWeight: 500 }}>
                                {s.label}
                            </span>
                            <span
                                style={{
                                    marginLeft: "auto",
                                    color: "var(--ink-3)",
                                    fontVariantNumeric: "tabular-nums",
                                    fontWeight: 500,
                                }}
                            >
                                {s.count}{" "}
                                <span style={{ color: "var(--ink-4)" }}>
                                    · {Math.round((s.count / total) * 100)}%
                                </span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function RecentActivity({ tickets, onOpen }) {
    const recent = [...tickets]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 6);
    return (
        <div className="card">
            <div className="card-hd">
                <h3>Atividade recente</h3>
                <span className="card-hd-sub">últimas 24h</span>
            </div>
            <div>
                {recent.map((t, i) => (
                    <div
                        key={t.id}
                        onClick={() => onOpen(t.id)}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 18px",
                            borderTop: i === 0 ? 0 : "0.5px solid var(--line-soft)",
                            cursor: "pointer",
                        }}
                        className="hover-row"
                    >
                        <Avatar user={USERS.find((u) => u.id === t.requester)} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    fontSize: 13,
                                    fontWeight: 550,
                                    color: "var(--ink)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    letterSpacing: "-0.005em",
                                }}
                            >
                                {t.title}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                                <span className="text-mono">{t.id}</span> · {t.department} ·{" "}
                                {relTime(t.updatedAt)}
                            </div>
                        </div>
                        <StatusBadge id={t.status} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DashboardScreen({ tickets, user, onOpen }) {
    const open = tickets.filter((t) => t.status === "aberto").length;
    const andamento = tickets.filter((t) => t.status === "andamento").length;
    const resolvido = tickets.filter(
        (t) => t.status === "resolvido" || t.status === "fechado",
    ).length;
    const critico = tickets.filter(
        (t) => t.priority === "critica" && t.status !== "fechado" && t.status !== "resolvido",
    ).length;
    const slaRisk = tickets.filter((t) => {
        if (t.status === "fechado" || t.status === "resolvido") return false;
        return slaInfo(t.slaDeadline).level !== "ok";
    }).length;

    // average resolution time (minutes) for resolved/closed
    const closed = tickets.filter((t) => t.status === "fechado" || t.status === "resolvido");
    const avgMin = closed.length
        ? Math.round(
              closed.reduce(
                  (s, t) => s + (new Date(t.updatedAt) - new Date(t.createdAt)) / 60000,
                  0,
              ) / closed.length,
          )
        : 0;
    const avgH = (avgMin / 60).toFixed(1);

    const isReq = user.role === "solicitante";

    return (
        <div>
            <div className="page-h">
                <div>
                    <h1>{isReq ? `Olá, ${user.name.split(" ")[0]}` : "Dashboard"}</h1>
                    <p>
                        {isReq
                            ? "Acompanhe seus chamados e abra novos quando precisar."
                            : "Visão geral do helpdesk de TI nesta semana."}
                    </p>
                </div>
                <div className="page-h-actions">
                    <button className="btn">{Ic.refresh}Atualizar</button>
                    <button className="btn btn-primary">{Ic.plus}Novo ticket</button>
                </div>
            </div>

            <div className="grid grid-4 mb-16">
                <div className="stat">
                    <div className="stat-lbl">Tickets abertos</div>
                    <div className="stat-val">{open}</div>
                    <div className="stat-delta down">{Ic.arrowDown}3 vs ontem</div>
                    <Sparkline data={[5, 8, 6, 10, 7, 9, open]} color="#1473e6" />
                </div>
                <div className="stat">
                    <div className="stat-lbl">Em andamento</div>
                    <div className="stat-val">{andamento}</div>
                    <div className="stat-delta up">{Ic.arrowUp}2 vs ontem</div>
                    <Sparkline data={[3, 4, 4, 6, 5, 5, andamento]} color="#d98c00" />
                </div>
                <div className="stat">
                    <div className="stat-lbl">Resolvidos / fechados</div>
                    <div className="stat-val">{resolvido}</div>
                    <div className="stat-delta up">{Ic.arrowUp}+8 esta semana</div>
                    <Sparkline data={[2, 3, 5, 4, 6, 7, resolvido]} color="#30b257" />
                </div>
                <div className="stat">
                    <div className="stat-lbl">Tempo médio de resolução</div>
                    <div className="stat-val">
                        {avgH}
                        <span style={{ fontSize: 16, color: "var(--ink-3)", marginLeft: 4 }}>
                            h
                        </span>
                    </div>
                    <div className="stat-delta up">{Ic.arrowDown}-1.2h vs semana passada</div>
                    <Sparkline data={[8, 7, 6, 7, 5, 4, parseFloat(avgH)]} color="#5e5ce6" />
                </div>
            </div>

            {(critico > 0 || slaRisk > 0) && !isReq && (
                <div
                    className="card mb-16"
                    style={{
                        background: "linear-gradient(180deg, #fff8f0, #fff)",
                        borderColor: "rgba(217,140,0,.25)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "14px 20px",
                        }}
                    >
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                background: "var(--amber-soft)",
                                color: "var(--amber)",
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                            }}
                        >
                            {Ic.alert}
                        </div>
                        <div style={{ flex: 1 }}>
                            <div
                                style={{
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    color: "var(--ink)",
                                    letterSpacing: "-0.005em",
                                }}
                            >
                                {critico} crítico{critico !== 1 ? "s" : ""} · {slaRisk} próximo
                                {slaRisk !== 1 ? "s" : ""} de estourar SLA
                            </div>
                            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                                Priorize esses chamados antes do final do expediente.
                            </div>
                        </div>
                        <button className="btn btn-sm">Ver lista</button>
                    </div>
                </div>
            )}

            <div className="grid grid-detail mb-16" style={{ alignItems: "start" }}>
                <RecentActivity tickets={tickets} onOpen={onOpen} />
                <PrioDistribution tickets={tickets.filter((t) => t.status !== "fechado")} />
            </div>

            <CatDistribution tickets={tickets} />
        </div>
    );
}

// ── Tickets list ─────────────────────────────────────────
function TicketsList({ tickets, user, onOpen, page, presetFilter }) {
    const [filter, setFilter] = React.useState(presetFilter || "todos");
    const [prioF, setPrioF] = React.useState("todos");
    const [catF, setCatF] = React.useState("todos");
    const [query, setQuery] = React.useState("");
    const [sort, setSort] = React.useState("updatedAt");

    React.useEffect(() => {
        if (presetFilter) setFilter(presetFilter);
    }, [presetFilter]);

    const isReq = user.role === "solicitante";
    const isAssigned = page === "atribuidos";

    const filtered = React.useMemo(() => {
        let list = [...tickets];
        if (isReq) list = list.filter((t) => t.requester === user.id);
        if (isAssigned) list = list.filter((t) => t.assignee === user.id);
        if (filter !== "todos") list = list.filter((t) => t.status === filter);
        if (prioF !== "todos") list = list.filter((t) => t.priority === prioF);
        if (catF !== "todos") list = list.filter((t) => t.category === catF);
        if (query)
            list = list.filter((t) =>
                (t.title + " " + t.id).toLowerCase().includes(query.toLowerCase()),
            );
        list.sort((a, b) => new Date(b[sort]) - new Date(a[sort]));
        return list;
    }, [tickets, filter, prioF, catF, query, sort, isReq, isAssigned, user]);

    const statusTabs = [
        {
            id: "todos",
            label: "Todos",
            count: tickets.filter((t) =>
                isReq ? t.requester === user.id : isAssigned ? t.assignee === user.id : true,
            ).length,
        },
        ...STATUSES.map((s) => ({
            id: s.id,
            label: s.label,
            count: tickets.filter(
                (t) =>
                    t.status === s.id &&
                    (isReq ? t.requester === user.id : isAssigned ? t.assignee === user.id : true),
            ).length,
        })),
    ];

    return (
        <div>
            <div className="page-h">
                <div>
                    <h1>{isAssigned ? "Atribuídos a mim" : isReq ? "Meus tickets" : "Tickets"}</h1>
                    <p>
                        {filtered.length} {filtered.length === 1 ? "chamado" : "chamados"}
                        {filter !== "todos" && " filtrados"}
                    </p>
                </div>
                <div className="page-h-actions">
                    <button className="btn">{Ic.filter}Exportar</button>
                    <button className="btn btn-primary">{Ic.plus}Novo ticket</button>
                </div>
            </div>

            <div className="tb">
                <div className="seg">
                    {statusTabs.map((t) => (
                        <button
                            key={t.id}
                            className={filter === t.id ? "on" : ""}
                            onClick={() => setFilter(t.id)}
                        >
                            {t.label}{" "}
                            {t.count > 0 && (
                                <span style={{ opacity: 0.55, marginLeft: 4 }}>{t.count}</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="tb-spacer" />
                <div className="search" style={{ minWidth: 220, height: 30 }}>
                    {Ic.search}
                    <input
                        placeholder="Filtrar…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
                <select
                    className="select"
                    style={{ width: 140, height: 30 }}
                    value={prioF}
                    onChange={(e) => setPrioF(e.target.value)}
                >
                    <option value="todos">Toda prioridade</option>
                    {PRIORITIES.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </select>
                <select
                    className="select"
                    style={{ width: 170, height: 30 }}
                    value={catF}
                    onChange={(e) => setCatF(e.target.value)}
                >
                    <option value="todos">Todas categorias</option>
                    {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="t-wrap">
                <table className="t">
                    <thead>
                        <tr>
                            <th style={{ width: 100 }}>ID</th>
                            <th>Título</th>
                            <th style={{ width: 160 }}>Categoria</th>
                            <th style={{ width: 110 }}>Prioridade</th>
                            <th style={{ width: 130 }}>Status</th>
                            <th style={{ width: 130 }}>Solicitante</th>
                            <th style={{ width: 110 }}>Atribuído</th>
                            <th style={{ width: 110 }}>SLA</th>
                            <th style={{ width: 80 }}>Atualizado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((t) => {
                            const req = USERS.find((u) => u.id === t.requester);
                            const asg = USERS.find((u) => u.id === t.assignee);
                            const sla = slaInfo(t.slaDeadline);
                            const isDone = t.status === "fechado" || t.status === "resolvido";
                            return (
                                <tr key={t.id} onClick={() => onOpen(t.id)}>
                                    <td>
                                        <span className="t-id">{t.id}</span>
                                    </td>
                                    <td>
                                        <div className="t-title">{t.title}</div>
                                        <div className="t-meta">{t.department}</div>
                                    </td>
                                    <td>
                                        <CatChip id={t.category} />
                                    </td>
                                    <td>
                                        <PrioPill id={t.priority} />
                                    </td>
                                    <td>
                                        <StatusBadge id={t.status} />
                                    </td>
                                    <td>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                            }}
                                        >
                                            <Avatar user={req} size="sm" />
                                            <span style={{ fontSize: 12.5 }}>
                                                {req?.name.split(" ")[0]}
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        {asg ? (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                }}
                                            >
                                                <Avatar user={asg} size="sm" />
                                                <span style={{ fontSize: 12.5 }}>
                                                    {asg.name.split(" ")[0]}
                                                </span>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
                                                —
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        {isDone ? (
                                            <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
                                                —
                                            </span>
                                        ) : (
                                            <span
                                                style={{
                                                    fontSize: 12,
                                                    fontVariantNumeric: "tabular-nums",
                                                    fontWeight: 500,
                                                    color:
                                                        sla.level === "crit"
                                                            ? "var(--red)"
                                                            : sla.level === "warn"
                                                              ? "var(--amber)"
                                                              : "var(--ink-2)",
                                                }}
                                            >
                                                {sla.past ? "⚠ vencido" : sla.label}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                                            {relTime(t.updatedAt)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan="9">
                                    <div className="empty">
                                        <h3>Nenhum ticket aqui</h3>Tente ajustar os filtros ou abra
                                        um novo chamado.
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── New Ticket ───────────────────────────────────────────
function NewTicket({ user, onCreate, onCancel }) {
    const [title, setTitle] = React.useState("");
    const [desc, setDesc] = React.useState("");
    const [cat, setCat] = React.useState("");
    const [prio, setPrio] = React.useState("media");
    const [dept, setDept] = React.useState(user.dept || "Fiscal");
    const [attachments, setAttachments] = React.useState([]);

    const valid = title.trim().length >= 5 && desc.trim().length >= 10 && cat;

    const submit = (e) => {
        e?.preventDefault();
        if (!valid) return;
        onCreate({
            title,
            description: desc,
            category: cat,
            priority: prio,
            department: dept,
            attachments,
        });
    };

    const addAttachment = () => {
        const names = [
            "captura-tela.png",
            "log-erro.txt",
            "planilha-erro.xlsx",
            "foto-equipamento.jpg",
        ];
        const sizes = ["124 KB", "8 KB", "2.4 MB", "480 KB"];
        const i = Math.floor(Math.random() * names.length);
        setAttachments([...attachments, { name: names[i], size: sizes[i] }]);
    };

    return (
        <div style={{ maxWidth: 760 }}>
            <div className="page-h">
                <div>
                    <h1>Novo ticket</h1>
                    <p>Descreva o problema com o máximo de detalhes para acelerar a resolução.</p>
                </div>
            </div>

            <form onSubmit={submit} className="card card-pad">
                <div className="field">
                    <label className="label">
                        Título <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <input
                        className="input"
                        placeholder="Resuma o problema em uma linha"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        autoFocus
                    />
                    <div className="help">
                        {title.length < 5
                            ? `Mínimo 5 caracteres (${title.length}/5)`
                            : "Bom! Curto e direto."}
                    </div>
                </div>

                <div className="field-row">
                    <div className="field">
                        <label className="label">
                            Categoria <span style={{ color: "var(--red)" }}>*</span>
                        </label>
                        <select
                            className="select"
                            value={cat}
                            onChange={(e) => setCat(e.target.value)}
                        >
                            <option value="">Selecionar categoria…</option>
                            {CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label} — {c.sub}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="field">
                        <label className="label">Departamento</label>
                        <select
                            className="select"
                            value={dept}
                            onChange={(e) => setDept(e.target.value)}
                        >
                            {DEPARTMENTS.map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="field">
                    <label className="label">Prioridade</label>
                    <div style={{ display: "flex", gap: 8 }}>
                        {PRIORITIES.map((p) => {
                            const active = prio === p.id;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setPrio(p.id)}
                                    className={`prio prio-${p.id}`}
                                    style={{
                                        flex: 1,
                                        padding: "10px 12px",
                                        borderRadius: 10,
                                        border: active
                                            ? "1.5px solid var(--accent)"
                                            : "0.5px solid var(--line-strong)",
                                        background: active ? "var(--accent-soft-2)" : "#fff",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: 12.5,
                                    }}
                                >
                                    <span className="prio-dot" style={{ width: 10, height: 10 }} />
                                    <div style={{ textAlign: "left" }}>
                                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                                            {p.label}
                                        </div>
                                        <div style={{ color: "var(--ink-3)", fontSize: 11 }}>
                                            SLA {p.hours}h
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="field">
                    <label className="label">
                        Descrição detalhada <span style={{ color: "var(--red)" }}>*</span>
                    </label>
                    <textarea
                        className="textarea"
                        rows="6"
                        placeholder={
                            'Inclua passos para reproduzir, mensagens de erro, urgência e qualquer informação que ajude o time de TI.\n\nEx: "Ao abrir o Domínio Sistemas, aparece a mensagem ‘erro de autenticação’ mesmo digitando a senha correta. Já reiniciei o computador."'
                        }
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                    />
                    <div className="help">{desc.length}/2000 caracteres</div>
                </div>

                <div className="field">
                    <label className="label">Anexos</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                        {attachments.map((a, i) => (
                            <span key={i} className="attach">
                                <span className="attach-ic">{Ic.file}</span>
                                <span className="attach-name">{a.name}</span>
                                <span className="attach-size">{a.size}</span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setAttachments(attachments.filter((_, j) => j !== i))
                                    }
                                    style={{
                                        border: 0,
                                        background: "transparent",
                                        color: "var(--ink-3)",
                                        padding: "0 0 0 4px",
                                        cursor: "pointer",
                                    }}
                                >
                                    ✕
                                </button>
                            </span>
                        ))}
                    </div>
                    <button type="button" className="btn btn-sm" onClick={addAttachment}>
                        {Ic.paperclip}Anexar arquivo
                    </button>
                    <div className="help">
                        Máx. 25MB por arquivo · png, jpg, pdf, xlsx, txt, log
                    </div>
                </div>

                <div className="div" />

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button type="button" className="btn">
                        Salvar rascunho
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!valid}>
                        Abrir ticket
                    </button>
                </div>
            </form>
        </div>
    );
}

Object.assign(window, { LoginScreen, DashboardScreen, TicketsList, NewTicket });
