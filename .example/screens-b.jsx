// NaveDesk — screens part 2: TicketDetail, Profile, Admin, FAQ
/* global React, Ic, Avatar, PrioPill, StatusBadge, CatChip, relTime, fmtDate, fmtDuration, slaInfo, USERS, CATEGORIES, DEPARTMENTS, PRIORITIES, STATUSES, FAQ_TOPICS, userById */

// ── Ticket Detail ────────────────────────────────────────
function HistoryItem({ item }) {
    const u = userById(item.by);
    let label = "",
        ico = Ic.refresh;
    if (item.type === "created") {
        label = "criou o ticket";
        ico = Ic.plus;
    } else if (item.type === "assigned") {
        const a = userById(item.to);
        label = (
            <>
                atribuiu para <b>{a?.name}</b>
            </>
        );
        ico = Ic.user;
    } else if (item.type === "status") {
        label = (
            <>
                mudou status para <b>{STATUSES.find((s) => s.id === item.to)?.label}</b>
            </>
        );
        ico = Ic.refresh;
    } else if (item.type === "priority") {
        label = (
            <>
                elevou prioridade para <b>{PRIORITIES.find((p) => p.id === item.to)?.label}</b>
            </>
        );
        ico = Ic.alert;
    }
    return (
        <div className="hist-item">
            <span className="hist-dot">{ico}</span>
            <span>
                <b>{u?.name.split(" ")[0]}</b> {label}
                <span className="hist-time">· {relTime(item.time)}</span>
            </span>
        </div>
    );
}

function Message({ msg }) {
    const u = userById(msg.author);
    return (
        <div className="msg">
            <Avatar user={u} />
            <div className="msg-bubble">
                <div className="msg-hd">
                    <span className="msg-name">{u?.name}</span>
                    <span className="msg-time">{fmtDate(msg.time)}</span>
                    {msg.internal && <span className="msg-tag internal">Nota interna</span>}
                </div>
                <div className="msg-body">{msg.body}</div>
                {msg.attachments &&
                    msg.attachments.map((a, i) => (
                        <span key={i} className="attach">
                            <span className="attach-ic">{Ic.file}</span>
                            <span className="attach-name">{a.name}</span>
                            <span className="attach-size">{a.size}</span>
                        </span>
                    ))}
            </div>
        </div>
    );
}

function Rating({ value, onChange, readOnly }) {
    return (
        <div className="rate">
            {[1, 2, 3, 4, 5].map((i) => (
                <button
                    key={i}
                    type="button"
                    onClick={() => !readOnly && onChange?.(i)}
                    className={i <= value ? "on" : ""}
                >
                    {i <= value ? Ic.star : Ic.starOutline}
                </button>
            ))}
        </div>
    );
}

function TicketDetail({ ticket, user, onUpdate, onBack }) {
    const [tab, setTab] = React.useState("public"); // 'public' | 'internal'
    const [draft, setDraft] = React.useState("");
    const [now, setNow] = React.useState(Date.now());

    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const requester = userById(ticket.requester);
    const assignee = userById(ticket.assignee);
    const isTech = user.role === "tecnico" || user.role === "admin";
    const isMe = ticket.requester === user.id;
    const sla = slaInfo(ticket.slaDeadline);
    const isDone = ticket.status === "fechado" || ticket.status === "resolvido";

    const sendMessage = () => {
        if (!draft.trim()) return;
        onUpdate({
            ...ticket,
            updatedAt: new Date().toISOString(),
            conversation: [
                ...ticket.conversation,
                {
                    id: "m" + (ticket.conversation.length + 1),
                    author: user.id,
                    time: new Date().toISOString(),
                    body: draft,
                    internal: tab === "internal",
                },
            ],
        });
        setDraft("");
    };

    const changeStatus = (status) => {
        onUpdate({
            ...ticket,
            status,
            updatedAt: new Date().toISOString(),
            history: [
                ...ticket.history,
                {
                    type: "status",
                    time: new Date().toISOString(),
                    by: user.id,
                    from: ticket.status,
                    to: status,
                },
            ],
        });
    };

    const takeOwnership = () => {
        onUpdate({
            ...ticket,
            assignee: user.id,
            status: "andamento",
            updatedAt: new Date().toISOString(),
            history: [
                ...ticket.history,
                { type: "assigned", time: new Date().toISOString(), by: user.id, to: user.id },
                {
                    type: "status",
                    time: new Date().toISOString(),
                    by: user.id,
                    from: ticket.status,
                    to: "andamento",
                },
            ],
        });
    };

    const slaPct = isDone
        ? 100
        : Math.max(
              0,
              Math.min(
                  100,
                  100 -
                      Math.abs(new Date(ticket.slaDeadline) - now) /
                          (PRIORITIES.find((p) => p.id === ticket.priority).hours * 36000),
              ),
          );

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <button className="btn btn-ghost btn-sm" onClick={onBack}>
                    {Ic.chevLeft}Voltar
                </button>
                <span className="text-mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {ticket.id}
                </span>
                <span style={{ color: "var(--ink-4)", fontSize: 12 }}>·</span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    Criado {relTime(ticket.createdAt)} por {requester?.name}
                </span>
            </div>

            <div className="detail-h">
                <div className="detail-id">{ticket.id}</div>
                <h2 className="detail-title">{ticket.title}</h2>
                <div className="detail-meta">
                    <StatusBadge id={ticket.status} />
                    <PrioPill id={ticket.priority} />
                    <CatChip id={ticket.category} />
                    <span>·</span>
                    <span>{ticket.department}</span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        {isTech && !assignee && (
                            <button className="btn btn-primary btn-sm" onClick={takeOwnership}>
                                {Ic.zap}Atribuir a mim
                            </button>
                        )}
                        {isTech && !isDone && (
                            <select
                                className="select"
                                style={{ width: 170, height: 30 }}
                                value={ticket.status}
                                onChange={(e) => changeStatus(e.target.value)}
                            >
                                {STATUSES.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        )}
                        <button className="btn btn-sm btn-ghost btn-icon" title="Mais">
                            {Ic.more}
                        </button>
                    </span>
                </div>
            </div>

            <div className="grid grid-detail" style={{ alignItems: "start" }}>
                {/* main column */}
                <div>
                    <div className="card">
                        <div className="card-hd">
                            <h3>Descrição</h3>
                        </div>
                        <div
                            className="card-pad"
                            style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}
                        >
                            {ticket.description}
                        </div>
                    </div>

                    <div className="card mt-16">
                        <div className="card-hd">
                            <h3>Conversa</h3>
                            <span className="card-hd-sub">
                                {ticket.conversation.length} mensagens
                            </span>
                        </div>
                        <div className="card-pad">
                            <div className="conv">
                                {ticket.conversation
                                    .filter((m) => !m.internal || isTech)
                                    .map((m, i) => (
                                        <Message key={i} msg={m} />
                                    ))}
                            </div>
                        </div>
                    </div>

                    {!isDone && (
                        <div className="compose">
                            {isTech && (
                                <div className="compose-tabs">
                                    <button
                                        className={tab === "public" ? "on" : ""}
                                        onClick={() => setTab("public")}
                                    >
                                        Resposta pública
                                    </button>
                                    <button
                                        className={tab === "internal" ? "on" : ""}
                                        onClick={() => setTab("internal")}
                                    >
                                        Nota interna
                                    </button>
                                </div>
                            )}
                            <textarea
                                placeholder={
                                    tab === "internal"
                                        ? "Visível só para a equipe de TI…"
                                        : "Escreva uma resposta…"
                                }
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                style={{
                                    background:
                                        tab === "internal" ? "var(--amber-soft)" : "transparent",
                                    padding: tab === "internal" ? "8px 10px" : 0,
                                    borderRadius: 6,
                                }}
                            />
                            <div className="compose-foot">
                                <button className="btn btn-sm btn-ghost btn-icon">
                                    {Ic.paperclip}
                                </button>
                                <span style={{ flex: 1 }} />
                                {isTech && !isMe && (
                                    <button
                                        className="btn btn-sm"
                                        onClick={() => changeStatus("resolvido")}
                                    >
                                        Resolver
                                    </button>
                                )}
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={sendMessage}
                                    disabled={!draft.trim()}
                                >
                                    {Ic.send}Enviar
                                </button>
                            </div>
                        </div>
                    )}

                    {isDone && isMe && !ticket.rating && (
                        <div className="card mt-16 card-pad">
                            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                                Como foi seu atendimento?
                            </div>
                            <div
                                style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}
                            >
                                Sua avaliação ajuda o time a melhorar.
                            </div>
                            <Rating
                                value={0}
                                onChange={(v) => onUpdate({ ...ticket, rating: v })}
                            />
                        </div>
                    )}

                    {isDone && ticket.rating && (
                        <div
                            className="card mt-16 card-pad"
                            style={{ display: "flex", alignItems: "center", gap: 14 }}
                        >
                            <div>
                                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                                    Avaliação do solicitante
                                </div>
                                <Rating value={ticket.rating} readOnly />
                            </div>
                            <div
                                style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" }}
                            >
                                Encerrado {relTime(ticket.updatedAt)} · resolvido por{" "}
                                {assignee?.name}
                            </div>
                        </div>
                    )}
                </div>

                {/* sidebar column */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {!isDone && (
                        <div className="sla">
                            <div className="sla-lbl">
                                {sla.past ? "SLA estourado" : "Tempo restante (SLA)"}
                            </div>
                            <div
                                className={`sla-time ${sla.level === "warn" ? "warn" : sla.level === "crit" ? "crit" : ""}`}
                            >
                                {sla.label}
                            </div>
                            <div
                                className={`sla-bar ${sla.level === "warn" ? "warn" : sla.level === "crit" ? "crit" : ""}`}
                            >
                                <div style={{ width: `${slaPct}%` }} />
                            </div>
                            <div className="sla-foot">
                                <span>
                                    Prioridade{" "}
                                    {PRIORITIES.find((p) => p.id === ticket.priority).label}
                                </span>
                                <span>
                                    {PRIORITIES.find((p) => p.id === ticket.priority).hours}h total
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="card">
                        <div className="card-hd">
                            <h3>Detalhes</h3>
                        </div>
                        <div
                            className="card-pad"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                                fontSize: 13,
                            }}
                        >
                            <DetailRow label="Solicitante">
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <Avatar user={requester} size="sm" />
                                    <div>
                                        <div style={{ fontWeight: 550 }}>{requester?.name}</div>
                                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                            {requester?.dept}
                                        </div>
                                    </div>
                                </div>
                            </DetailRow>
                            <DetailRow label="Atribuído a">
                                {assignee ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <Avatar user={assignee} size="sm" />
                                        <span style={{ fontWeight: 550 }}>{assignee.name}</span>
                                    </div>
                                ) : (
                                    <span style={{ color: "var(--ink-4)" }}>—</span>
                                )}
                            </DetailRow>
                            <DetailRow label="Categoria">
                                <CatChip id={ticket.category} />
                            </DetailRow>
                            <DetailRow label="Departamento">{ticket.department}</DetailRow>
                            <DetailRow label="Criado em">{fmtDate(ticket.createdAt)}</DetailRow>
                            <DetailRow label="Atualizado">{relTime(ticket.updatedAt)}</DetailRow>
                            <DetailRow label="Tempo gasto">
                                <span
                                    style={{ fontVariantNumeric: "tabular-nums", fontWeight: 550 }}
                                >
                                    {fmtDuration(ticket.timeSpent)}
                                </span>
                            </DetailRow>
                            {isTech && !isDone && (
                                <button className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
                                    {Ic.clock}Adicionar apontamento
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-hd">
                            <h3>Histórico</h3>
                        </div>
                        <div className="card-pad">
                            <div className="hist">
                                {[...ticket.history].reverse().map((h, i) => (
                                    <HistoryItem key={i} item={h} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DetailRow({ label, children }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 90, color: "var(--ink-3)", fontSize: 12 }}>{label}</span>
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
    );
}

// ── Profile ─────────────────────────────────────────────
function ProfileScreen({ user, tickets, onUpdate }) {
    const myTickets = tickets.filter((t) => t.requester === user.id || t.assignee === user.id);
    const open = myTickets.filter((t) => t.status !== "fechado" && t.status !== "resolvido").length;
    const resolved = myTickets.filter(
        (t) => t.status === "resolvido" || t.status === "fechado",
    ).length;
    const avgRating = (() => {
        const rated = tickets.filter((t) => t.assignee === user.id && t.rating);
        if (!rated.length) return null;
        return (rated.reduce((s, t) => s + t.rating, 0) / rated.length).toFixed(1);
    })();

    return (
        <div style={{ maxWidth: 880 }}>
            <div className="page-h">
                <div>
                    <h1>Perfil</h1>
                    <p>Suas informações de usuário e estatísticas.</p>
                </div>
            </div>

            <div
                className="card card-pad"
                style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}
            >
                <Avatar user={user} size="xl" />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        {user.name}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                        {user.email}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <span className="badge badge-indigo badge-clean">
                            {user.role === "admin"
                                ? "Administrador"
                                : user.role === "tecnico"
                                  ? "Técnico TI"
                                  : "Solicitante"}
                        </span>
                        <span className="badge badge-grey badge-clean">{user.dept}</span>
                    </div>
                </div>
                <div>
                    <button className="btn">{Ic.edit}Editar perfil</button>
                </div>
            </div>

            <div className="grid grid-3 mb-16">
                <div className="stat">
                    <div className="stat-lbl">Tickets em aberto</div>
                    <div className="stat-val">{open}</div>
                </div>
                <div className="stat">
                    <div className="stat-lbl">Resolvidos</div>
                    <div className="stat-val">{resolved}</div>
                </div>
                <div className="stat">
                    <div className="stat-lbl">
                        {user.role === "solicitante" ? "Tempo médio espera" : "Avaliação média"}
                    </div>
                    <div className="stat-val">
                        {user.role === "solicitante" ? (
                            <>
                                4,2<span style={{ fontSize: 16, color: "var(--ink-3)" }}>h</span>
                            </>
                        ) : avgRating ? (
                            <>
                                {avgRating}
                                <span style={{ fontSize: 16, color: "var(--ink-3)" }}> / 5</span>
                            </>
                        ) : (
                            "—"
                        )}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-hd">
                    <h3>Dados pessoais</h3>
                </div>
                <div className="card-pad">
                    <div className="field-row">
                        <div className="field">
                            <label className="label">Nome</label>
                            <input className="input" defaultValue={user.name} />
                        </div>
                        <div className="field">
                            <label className="label">E-mail</label>
                            <input className="input" defaultValue={user.email} />
                        </div>
                    </div>
                    <div className="field-row">
                        <div className="field">
                            <label className="label">Departamento</label>
                            <select className="select" defaultValue={user.dept}>
                                {DEPARTMENTS.map((d) => (
                                    <option key={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                        <div className="field">
                            <label className="label">Ramal</label>
                            <input className="input" placeholder="2154" />
                        </div>
                    </div>
                    <div className="field">
                        <label className="label">Notificações</label>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                                fontSize: 13,
                                color: "var(--ink-2)",
                            }}
                        >
                            <CheckRow
                                defaultChecked
                                label="Avisos por e-mail quando um técnico responde meu ticket"
                            />
                            <CheckRow
                                defaultChecked
                                label="Avisos push no navegador para tickets críticos"
                            />
                            <CheckRow label="Resumo diário às 17h" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CheckRow({ defaultChecked, label }) {
    const [on, setOn] = React.useState(!!defaultChecked);
    return (
        <label
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                userSelect: "none",
            }}
        >
            <span
                onClick={() => setOn(!on)}
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: on ? "var(--accent)" : "#fff",
                    border: `0.5px solid ${on ? "var(--accent)" : "var(--line-strong)"}`,
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                    transition: "all .12s",
                }}
            >
                {on && (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path
                            d="M2 6.5 5 9.5 10 3.5"
                            stroke="white"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                )}
            </span>
            {label}
        </label>
    );
}

// ── Admin ───────────────────────────────────────────────
function AdminScreen() {
    const [tab, setTab] = React.useState("usuarios");

    return (
        <div>
            <div className="page-h">
                <div>
                    <h1>Configurações</h1>
                    <p>Administração do NaveDesk — usuários, SLAs, categorias e integrações.</p>
                </div>
            </div>

            <div className="tb">
                <div className="seg">
                    <button
                        className={tab === "usuarios" ? "on" : ""}
                        onClick={() => setTab("usuarios")}
                    >
                        Usuários
                    </button>
                    <button className={tab === "sla" ? "on" : ""} onClick={() => setTab("sla")}>
                        SLAs
                    </button>
                    <button className={tab === "cats" ? "on" : ""} onClick={() => setTab("cats")}>
                        Categorias
                    </button>
                    <button
                        className={tab === "integracoes" ? "on" : ""}
                        onClick={() => setTab("integracoes")}
                    >
                        Integrações
                    </button>
                    <button className={tab === "geral" ? "on" : ""} onClick={() => setTab("geral")}>
                        Geral
                    </button>
                </div>
            </div>

            {tab === "usuarios" && <AdminUsers />}
            {tab === "sla" && <AdminSLA />}
            {tab === "cats" && <AdminCategories />}
            {tab === "integracoes" && <AdminIntegrations />}
            {tab === "geral" && <AdminGeneral />}
        </div>
    );
}

function AdminUsers() {
    return (
        <div className="t-wrap">
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 14px",
                    borderBottom: "0.5px solid var(--line)",
                }}
            >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{USERS.length} usuários</div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn btn-sm">{Ic.filter}Filtrar</button>
                    <button className="btn btn-sm btn-primary">{Ic.plus}Novo usuário</button>
                </div>
            </div>
            <table className="t">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th style={{ width: 280 }}>E-mail</th>
                        <th style={{ width: 150 }}>Departamento</th>
                        <th style={{ width: 130 }}>Papel</th>
                        <th style={{ width: 110 }}>Status</th>
                        <th style={{ width: 50 }}></th>
                    </tr>
                </thead>
                <tbody>
                    {USERS.map((u) => (
                        <tr key={u.id}>
                            <td>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <Avatar user={u} size="sm" />
                                    <span style={{ fontWeight: 550 }}>{u.name}</span>
                                </div>
                            </td>
                            <td>
                                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                                    {u.email}
                                </span>
                            </td>
                            <td>{u.dept}</td>
                            <td>
                                <span
                                    className={`badge badge-clean ${u.role === "admin" ? "badge-indigo" : u.role === "tecnico" ? "badge-blue" : "badge-grey"}`}
                                >
                                    {u.role === "admin"
                                        ? "Administrador"
                                        : u.role === "tecnico"
                                          ? "Técnico TI"
                                          : "Solicitante"}
                                </span>
                            </td>
                            <td>
                                <span className="badge badge-green">Ativo</span>
                            </td>
                            <td>
                                <button className="btn btn-ghost btn-icon btn-sm">{Ic.more}</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AdminSLA() {
    return (
        <div className="card">
            <div className="card-hd">
                <h3>Tempos de resposta por prioridade</h3>
                <span className="card-hd-sub">Horário comercial</span>
            </div>
            <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {PRIORITIES.map((p) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <PrioPill id={p.id} />
                        <div style={{ flex: 1 }}>
                            <div className="bar">
                                <div
                                    style={{
                                        width: `${100 - (p.hours / 48) * 100}%`,
                                        background:
                                            p.id === "critica"
                                                ? "var(--red)"
                                                : p.id === "alta"
                                                  ? "var(--amber)"
                                                  : p.id === "media"
                                                    ? "var(--blue)"
                                                    : "#8a8a93",
                                    }}
                                />
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                                className="input"
                                style={{ width: 64, textAlign: "right" }}
                                defaultValue={p.hours}
                            />
                            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>horas</span>
                        </div>
                    </div>
                ))}
                <div className="div" />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button className="btn">Restaurar padrões</button>
                    <button className="btn btn-primary">Salvar</button>
                </div>
            </div>
        </div>
    );
}

function AdminCategories() {
    return (
        <div className="grid grid-2">
            {CATEGORIES.map((c) => (
                <div
                    key={c.id}
                    className="card card-pad"
                    style={{ display: "flex", alignItems: "center", gap: 14 }}
                >
                    <span
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
                            display: "grid",
                            placeItems: "center",
                        }}
                    >
                        {Ic[c.icon]}
                    </span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.label}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.sub}</div>
                    </div>
                    <button className="btn btn-ghost btn-icon btn-sm">{Ic.edit}</button>
                </div>
            ))}
            <div
                className="card card-pad"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    border: "1px dashed var(--line-strong)",
                    background: "transparent",
                    cursor: "pointer",
                }}
            >
                <span
                    style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: "rgba(0,0,0,.04)",
                        color: "var(--ink-3)",
                        display: "grid",
                        placeItems: "center",
                    }}
                >
                    {Ic.plus}
                </span>
                <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 500 }}>
                    Nova categoria
                </div>
            </div>
        </div>
    );
}

function AdminIntegrations() {
    const items = [
        {
            name: "Microsoft 365",
            desc: "Sincroniza usuários, e-mail e SSO via Azure AD",
            status: "Conectado",
            color: "green",
        },
        {
            name: "Slack",
            desc: "Notificações de tickets no canal #ti",
            status: "Conectado",
            color: "green",
        },
        {
            name: "AnyDesk",
            desc: "Acesso remoto integrado ao ticket",
            status: "Conectado",
            color: "green",
        },
        {
            name: "Domínio Sistemas",
            desc: "Webhook para alertas de licenciamento",
            status: "Pendente",
            color: "amber",
        },
        {
            name: "WhatsApp Business",
            desc: "Abertura de ticket via WhatsApp",
            status: "Não conectado",
            color: "grey",
        },
    ];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((it) => (
                <div
                    key={it.name}
                    className="card card-pad"
                    style={{ display: "flex", alignItems: "center", gap: 16 }}
                >
                    <div
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            background: "var(--bg-sunk)",
                            display: "grid",
                            placeItems: "center",
                            fontWeight: 600,
                            color: "var(--ink-2)",
                            fontSize: 11,
                        }}
                    >
                        {it.name
                            .split(" ")
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join("")}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.name}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{it.desc}</div>
                    </div>
                    <span className={`badge badge-${it.color}`}>{it.status}</span>
                    <button className="btn btn-sm">
                        {it.color === "green" ? "Configurar" : "Conectar"}
                    </button>
                </div>
            ))}
        </div>
    );
}

function AdminGeneral() {
    return (
        <div className="card card-pad" style={{ maxWidth: 600 }}>
            <div className="field">
                <label className="label">Nome da empresa</label>
                <input className="input" defaultValue="Contábil Andrade Ltda." />
            </div>
            <div className="field">
                <label className="label">Horário de atendimento</label>
                <div className="field-row">
                    <input className="input" defaultValue="08:00" />
                    <input className="input" defaultValue="18:00" />
                </div>
            </div>
            <div className="field">
                <label className="label">E-mail de notificações</label>
                <input className="input" defaultValue="ti@contabilandrade.com.br" />
            </div>
            <div className="field">
                <label className="label">Auto-fechamento</label>
                <CheckRow
                    defaultChecked
                    label="Fechar tickets resolvidos sem resposta após 3 dias"
                />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn">Cancelar</button>
                <button className="btn btn-primary">Salvar alterações</button>
            </div>
        </div>
    );
}

// ── FAQ ─────────────────────────────────────────────────
function FAQScreen() {
    const [active, setActive] = React.useState(null);
    const groups = CATEGORIES.map((c) => ({
        cat: c,
        items: FAQ_TOPICS.filter((f) => f.cat === c.id),
    })).filter((g) => g.items.length > 0);

    return (
        <div>
            <div className="page-h">
                <div>
                    <h1>Base de conhecimento</h1>
                    <p>
                        Resolva você mesmo problemas comuns. {FAQ_TOPICS.length} artigos
                        disponíveis.
                    </p>
                </div>
                <div className="page-h-actions">
                    <button className="btn">{Ic.plus}Sugerir artigo</button>
                </div>
            </div>

            <div
                className="card card-pad mb-16"
                style={{
                    background: "linear-gradient(135deg, var(--accent-soft), transparent)",
                    borderColor: "rgba(94,92,230,0.2)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div
                        style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            background: "#fff",
                            color: "var(--accent)",
                            display: "grid",
                            placeItems: "center",
                            boxShadow: "var(--sh-1)",
                        }}
                    >
                        {Ic.search}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
                            Procurando algo específico?
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
                            Tente "resetar senha", "VPN", "impressora", "Domínio Sistemas"…
                        </div>
                    </div>
                    <input
                        className="input"
                        style={{ width: 320, height: 38, borderRadius: 10 }}
                        placeholder="Buscar artigos…"
                    />
                </div>
            </div>

            <div className="grid grid-4 mb-16">
                {groups.slice(0, 4).map((g) => (
                    <div key={g.cat.id} className="faq-cat" onClick={() => setActive(g.cat.id)}>
                        <div className="faq-cat-ic">{Ic[g.cat.icon]}</div>
                        <h4>{g.cat.label}</h4>
                        <p>
                            {g.items.length} artigo{g.items.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                ))}
            </div>

            <div className="card">
                <div className="card-hd">
                    <h3>Artigos populares</h3>
                    <span className="card-hd-sub">mais consultados nos últimos 30 dias</span>
                </div>
                <div>
                    {[...FAQ_TOPICS]
                        .sort((a, b) => b.count - a.count)
                        .map((f, i) => {
                            const c = CATEGORIES.find((c) => c.id === f.cat);
                            return (
                                <div
                                    key={f.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 14,
                                        padding: "13px 18px",
                                        borderTop: i === 0 ? 0 : "0.5px solid var(--line-soft)",
                                        cursor: "pointer",
                                    }}
                                    onMouseEnter={(e) =>
                                        (e.currentTarget.style.background = "#fafafb")
                                    }
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                                >
                                    <span
                                        style={{
                                            width: 28,
                                            height: 28,
                                            borderRadius: 8,
                                            background: "var(--bg-sunk)",
                                            color: "var(--ink-3)",
                                            display: "grid",
                                            placeItems: "center",
                                        }}
                                    >
                                        {Ic[c.icon]}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div
                                            style={{
                                                fontSize: 13.5,
                                                fontWeight: 550,
                                                letterSpacing: "-0.005em",
                                            }}
                                        >
                                            {f.title}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11.5,
                                                color: "var(--ink-3)",
                                                marginTop: 2,
                                            }}
                                        >
                                            {c.label}
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: 12,
                                            color: "var(--ink-4)",
                                            fontVariantNumeric: "tabular-nums",
                                        }}
                                    >
                                        {f.count} acessos
                                    </span>
                                    {Ic.chevRight}
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}

Object.assign(window, { TicketDetail, ProfileScreen, AdminScreen, FAQScreen });
