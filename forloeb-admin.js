/* Backend til kundesiden: opret forløb, sæt købte timer, giv forældre adgang
 * og skriv en rapport efter hver gang.
 *
 * Bruger samme login som /admin (sessionen deles i browseren). Databasen
 * afviser alt, hvis den indloggede mail ikke står i admin_emails. */

import {
  supabase, FORLOEB_SELECT, toCustomer, stats, flags, today,
  fmtDate, fmtNum, fmtHours, firstName, possessive, esc,
} from "./forloeb-common.js";
import {
  loadInvoices, invoiceStat, invoiceCard, settingsForm, refreshInvoiceTotal,
  handleInvoiceSubmit, handleInvoiceClick,
} from "./faktura-admin.js";

const $ = (id) => document.getElementById(id);

let customers = [];
let activeId = null;
let mode = "view"; // "view", "new" eller "settings" (fakturaoplysninger)
let editingSessionId = null;

const active = () => customers.find((c) => c.id === activeId) || null;

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
function showError(text) {
  $("app-error").textContent = text;
  $("app-error").hidden = !text;
  if (text) $("app-error").scrollIntoView({ block: "nearest" });
}

/* ---------- Data ---------- */

async function load() {
  const [{ data, error }] = await Promise.all([
    supabase.from("forloeb").select(FORLOEB_SELECT).order("student"),
    loadInvoices(),
  ]);
  if (error) { showError(`Kunne ikke hente forløbene: ${error.message}`); return false; }
  customers = (data || []).map(toCustomer);
  if (!active()) activeId = customers[0] ? customers[0].id : null;
  render();
  return true;
}

/* Kører en skrivning, viser fejlen hvis den mislykkes, og henter ellers alt igen. */
async function write(request, okText) {
  showError("");
  const { error } = await request;
  if (error) { showError(`Det kunne ikke gemmes: ${error.message}`); return false; }
  await load();
  if (okText) toast(okText);
  return true;
}

async function sendInvite(parentId, email) {
  const { error } = await supabase.functions.invoke("forloeb-login", {
    body: { action: "invite", parent_id: parentId },
  });
  if (error) {
    let detail = "";
    try { detail = (await error.context.json()).error || ""; } catch { /* intet svar at læse */ }
    showError(`Login-linket til ${email} blev ikke sendt${detail ? `: ${detail}` : ""}. Prøv "Send link igen".`);
    return false;
  }
  await load();
  toast(`Login-link sendt til ${email}.`);
  return true;
}

/* ---------- Nøgletal og kundeliste ---------- */

function renderStats() {
  const hoursLeft = customers.reduce((sum, c) => sum + stats(c).left, 0);
  const missing = customers.filter((c) => flags(c).some((f) => f.kind === "report")).length;
  const low = customers.filter((c) => stats(c).left <= 3).length;
  $("stats").innerHTML = `
    <div class="stat"><b>${customers.length}</b><span>aktive forløb</span></div>
    <div class="stat"><b>${esc(fmtNum(hoursLeft))}</b><span>solgte timer, der mangler at blive afholdt</span></div>
    <div class="stat${missing ? " alert" : ""}"><b>${missing}</b><span>rapporter mangler</span></div>
    <div class="stat${low ? " alert" : ""}"><b>${low}</b><span>pakker er ved at være brugt</span></div>${invoiceStat()}`;
}

function renderList() {
  $("cust-list").innerHTML = customers.map((c) => {
    const st = stats(c);
    const fl = flags(c);
    const pct = st.bought ? Math.min(100, (st.used / st.bought) * 100) : 0;
    return `
      <button class="cust${c.id === activeId && mode === "view" ? " is-active" : ""}" type="button" data-customer="${esc(c.id)}">
        <span class="cust-top"><strong>${esc(c.student)}</strong><span>${esc(fmtNum(st.left))} af ${esc(fmtNum(st.bought))} t tilbage</span></span>
        <span class="small muted">${esc([c.subject, c.grade].filter(Boolean).join(" · "))}</span>
        <span class="meter${st.left <= 3 ? " low" : ""}" style="display:block"><span style="width:${pct}%"></span></span>
        <span class="chips">${fl.length
          ? fl.map((f) => `<span class="chip ${f.kind}">${esc(f.text)}</span>`).join("")
          : `<span class="chip ok">Alt er på plads</span>`}</span>
      </button>`;
  }).join("") || `<p class="muted">Ingen forløb endnu. Tryk "+ Ny kunde" for at oprette det første.</p>`;
}

/* ---------- Detalje ---------- */

function levelPicker(value) {
  return `<div class="level-pick" role="radiogroup" aria-label="Forståelse af emnet, 1 til 5">${[1, 2, 3, 4, 5].map((n) => (
    `<label><input type="radio" name="level" value="${n}" ${Number(value) === n ? "checked" : ""}><span>${n}</span></label>`
  )).join("")}</div>`;
}

function sessionForm(c) {
  const editing = c.sessions.find((s) => s.id === editingSessionId) || null;
  const missing = flags(c).find((f) => f.kind === "report");
  const s = editing || { date: missing ? c.next.date : today(), hours: 1.5, level: 3, topic: "", worked: "", good: "", next: "" };
  const lengths = [1, 1.5, 2, 2.5, 3];
  if (!lengths.includes(s.hours)) lengths.push(s.hours);
  return `
    <form id="session-form" class="card">
      <h2>${editing ? "Ret rapport" : "Skriv rapport for en gang"}</h2>
      ${!editing && missing ? `<p class="notice notice-warn" style="margin-bottom:14px">${esc(missing.text)}. Datoen er sat ind for dig.</p>` : ""}
      <div class="form-grid">
        <label class="field">Dato<input type="date" name="date" value="${esc(s.date)}" required></label>
        <label class="field">Varighed
          <select name="hours">${lengths.map((h) => `<option value="${h}" ${s.hours === h ? "selected" : ""}>${esc(fmtHours(h))}</option>`).join("")}</select>
        </label>
        <label class="field span-all">Emne (overskriften på punktet i forløbsvejen)<input name="topic" value="${esc(s.topic)}" placeholder="F.eks. Vektorer i rummet" required maxlength="80"></label>
        <label class="field span-all">Det arbejdede vi med<textarea name="worked" required maxlength="4000">${esc(s.worked)}</textarea></label>
        <label class="field span-all">Det gik godt<textarea name="good" maxlength="4000">${esc(s.good)}</textarea></label>
        <label class="field span-all">Til næste gang<textarea name="next" maxlength="4000">${esc(s.next)}</textarea></label>
        <div class="field span-all" style="display:grid;gap:6px;font-size:0.82rem;font-weight:700;color:var(--heading)">Forståelse af emnet (1 = helt nyt, 5 = sidder fast)${levelPicker(s.level)}</div>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">${editing ? "Gem ændringer" : "Gem rapport"}</button>
        ${editing
          ? `<button class="button button-ghost" type="button" data-action="cancel-edit">Fortryd</button>`
          : `<span class="small muted">Forældrene kan læse rapporten, så snart den er gemt.</span>`}
      </div>
    </form>`;
}

function renderDetail() {
  const box = $("detail");
  if (mode === "new") { box.innerHTML = newCustomerForm(); return; }
  if (mode === "settings") { box.innerHTML = settingsForm(); return; }
  const c = active();
  if (!c) { box.innerHTML = `<div class="card"><p class="muted">Vælg en kunde, eller opret den første.</p></div>`; return; }
  const st = stats(c);
  const pct = st.bought ? Math.min(100, (st.used / st.bought) * 100) : 0;

  box.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="kicker">${esc([c.subject, c.grade].filter(Boolean).join(" · "))}</p>
        <h1>${esc(c.student)}</h1>
      </div>
      <a class="button button-ghost button-small" href="forloeb.html?vis=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Se siden som forælder ↗</a>
    </div>

    <div class="two-col">
      <section class="card">
        <h2>Timer</h2>
        <p class="big-num">${esc(fmtNum(st.left))} <small>af ${esc(fmtNum(st.bought))} timer tilbage</small></p>
        <div class="meter${st.left <= 3 ? " low" : ""}"><span style="width:${pct}%"></span></div>
        <div class="rows" style="margin-top:12px">
          ${c.packages.map((p) => `
            <div class="row"><span><strong>${esc(fmtHours(p.hours))}</strong> købt ${esc(fmtDate(p.date))}</span>
            <button class="button-link danger" type="button" data-action="del-package" data-id="${esc(p.id)}">Fjern</button></div>`).join("")
            || `<p class="muted small">Ingen timer er lagt ind endnu.</p>`}
        </div>
        <details class="inline">
          <summary>+ Tilføj timepakke</summary>
          <form id="package-form" class="form-grid">
            <label class="field">Antal timer<input type="number" name="hours" value="20" min="0.5" max="500" step="0.5" required list="package-sizes">
              <datalist id="package-sizes"><option value="1"></option><option value="10"></option><option value="20"></option><option value="40"></option></datalist>
            </label>
            <label class="field">Købt den<input type="date" name="date" value="${esc(today())}" required></label>
            <div class="span-all"><button class="button button-primary button-small" type="submit">Læg timer til</button></div>
          </form>
        </details>
      </section>

      <section class="card">
        <h2>Forældre-login</h2>
        <div class="rows">
          ${c.parents.map((p) => `
            <div class="row">
              <span><strong>${esc(p.name)}</strong><br><span class="small muted">${esc(p.email)} · ${
                p.lastLogin ? `sidst inde ${esc(fmtDate(p.lastLogin))}`
                  : p.invited ? `inviteret ${esc(fmtDate(p.invited))}, har ikke logget ind`
                    : "invitation ikke sendt"}</span></span>
              <span class="row-actions">
                <button class="button-link" type="button" data-action="resend" data-id="${esc(p.id)}" data-email="${esc(p.email)}">Send link igen</button>
                <button class="button-link danger" type="button" data-action="del-parent" data-id="${esc(p.id)}" data-email="${esc(p.email)}">Fjern adgang</button>
              </span>
            </div>`).join("") || `<p class="muted small">Ingen forældre har adgang endnu.</p>`}
        </div>
        <details class="inline">
          <summary>+ Giv en forælder adgang</summary>
          <form id="parent-form" class="form-grid">
            <label class="field">Navn<input name="name" required maxlength="80" placeholder="Fornavn Efternavn"></label>
            <label class="field">E-mail<input type="email" name="email" required maxlength="200" placeholder="navn@eksempel.dk"></label>
            <div class="span-all"><button class="button button-primary button-small" type="submit">Send invitation</button></div>
          </form>
        </details>
      </section>
    </div>

    ${invoiceCard(c)}

    <form id="plan-form" class="card">
      <h2>Forløbet</h2>
      <div class="form-grid">
        <label class="field">Elevens navn<input name="student" value="${esc(c.student)}" required maxlength="80"></label>
        <label class="field">Klassetrin<input name="grade" value="${esc(c.grade)}" maxlength="40"></label>
        <label class="field">Fag<input name="subject" value="${esc(c.subject)}" maxlength="80"></label>
        <label class="field">Næste gang<input type="date" name="date" value="${esc(c.next.date)}"></label>
        <label class="field">Klokken<input type="time" name="time" value="${esc(c.next.time)}"></label>
        <label class="field span-all">Målet for forløbet (står for enden af vejen)<input name="goal" value="${esc(c.goal)}" maxlength="80"></label>
      </div>
      <div class="form-actions"><button class="button button-ghost button-small" type="submit">Gem</button></div>
    </form>

    ${sessionForm(c)}

    <section class="card">
      <h2>Rapporter (${c.sessions.length})</h2>
      ${c.sessions.map((s, i) => `
        <div class="session-item">
          <header>
            <strong>${i + 1}. ${esc(s.topic)}</strong>
            <span class="row-actions">
              <span class="muted">${esc(fmtDate(s.date))} · ${esc(fmtHours(s.hours))}</span>
              <button class="button-link" type="button" data-action="edit-session" data-id="${esc(s.id)}">Ret</button>
              <button class="button-link danger" type="button" data-action="del-session" data-id="${esc(s.id)}">Slet</button>
            </span>
          </header>
          <p class="muted">${esc(s.worked)}</p>
        </div>`).reverse().join("") || `<p class="muted">Ingen rapporter endnu.</p>`}
    </section>

    <p class="small"><button class="button-link danger" type="button" data-action="del-customer">Slet hele forløbet</button></p>`;
}

function newCustomerForm() {
  return `
    <form id="customer-form" class="card">
      <p class="kicker">Ny kunde</p>
      <h1 style="font-size:1.7rem;margin-bottom:16px">Opret et forløb</h1>
      <div class="form-grid">
        <label class="field">Elevens navn<input name="student" required maxlength="80" placeholder="Fornavn Efternavn"></label>
        <label class="field">Klassetrin<input name="grade" maxlength="40" placeholder="F.eks. 2.g"></label>
        <label class="field">Fag<input name="subject" maxlength="80" placeholder="F.eks. Matematik A"></label>
        <label class="field">Købte timer<input type="number" name="hours" value="20" min="0.5" max="500" step="0.5" required></label>
        <label class="field">Forælderens navn<input name="parentName" required maxlength="80"></label>
        <label class="field">Forælderens e-mail<input type="email" name="parentEmail" required maxlength="200"></label>
        <label class="field span-all">Mål for forløbet<input name="goal" placeholder="F.eks. Tryg til eksamen i maj" maxlength="80"></label>
        <label class="span-all" style="display:flex;gap:10px;align-items:center;font-size:0.9rem">
          <input type="checkbox" name="invite" checked style="width:auto"> Send forælderen en mail med login-link nu
        </label>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Opret forløb</button>
        <button class="button button-ghost" type="button" data-action="cancel-new">Fortryd</button>
      </div>
    </form>`;
}

function render() {
  renderStats();
  renderList();
  renderDetail();
  refreshInvoiceTotal();
}

/* Det, fakturadelen (faktura-admin.js) må bede denne side om. */
const ui = {
  toast, showError,
  reload: () => load(),
  setMode: (next) => {
    mode = next;
    render();
    $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  },
};

/* ---------- Handlinger ---------- */

const formValues = (form) => Object.fromEntries(new FormData(form).entries());
const text = (value) => String(value || "").trim();

$("cust-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-customer]");
  if (!button) return;
  activeId = button.dataset.customer;
  mode = "view";
  editingSessionId = null;
  render();
  if (window.matchMedia("(max-width: 900px)").matches) $("detail").scrollIntoView({ behavior: "smooth" });
});

$("new-customer").addEventListener("click", () => {
  mode = "new";
  render();
  $("detail").scrollIntoView({ behavior: "smooth" });
});

$("detail").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const submits = [...form.querySelectorAll('[type="submit"]')].filter((b) => !b.disabled);
  if (form.dataset.busy) return;
  form.dataset.busy = "1";
  submits.forEach((b) => { b.disabled = true; });
  try {
    await handleSubmit(form, formValues(form), event.submitter);
  } finally {
    delete form.dataset.busy;
    submits.forEach((b) => { if (b.isConnected) b.disabled = false; });
  }
});

$("detail").addEventListener("input", (event) => {
  if (event.target.closest("#invoice-form")) refreshInvoiceTotal(event.target);
});

async function handleSubmit(form, v, submitter) {
  const c = active();
  if (await handleInvoiceSubmit(form, v, c, submitter, ui)) return;

  if (form.id === "customer-form") {
    showError("");
    const { data: created, error } = await supabase.from("forloeb").insert({
      student: text(v.student), grade: text(v.grade), subject: text(v.subject), goal: text(v.goal),
    }).select("id").single();
    if (error) { showError(`Forløbet kunne ikke oprettes: ${error.message}`); return; }
    const email = text(v.parentEmail).toLowerCase();
    const [pkg, parent] = await Promise.all([
      supabase.from("forloeb_packages").insert({ forloeb_id: created.id, hours: Number(v.hours) }),
      supabase.from("forloeb_parents").insert({ forloeb_id: created.id, name: text(v.parentName), email }).select("id").single(),
    ]);
    activeId = created.id;
    mode = "view";
    await load();
    if (pkg.error || parent.error) {
      showError(`Forløbet er oprettet, men ${pkg.error ? "timerne" : "forælderen"} kunne ikke gemmes: ${(pkg.error || parent.error).message}`);
      return;
    }
    if (v.invite) await sendInvite(parent.data.id, email);
    else toast("Forløbet er oprettet. Invitationen er ikke sendt endnu.");
    return;
  }
  if (!c) return;

  if (form.id === "package-form") {
    await write(
      supabase.from("forloeb_packages").insert({ forloeb_id: c.id, hours: Number(v.hours), bought_on: v.date }),
      `${fmtHours(Number(v.hours))} lagt til ${possessive(c.student)} forløb.`,
    );
  } else if (form.id === "parent-form") {
    const email = text(v.email).toLowerCase();
    if (c.parents.some((p) => p.email === email)) { toast("Den mail har allerede adgang."); return; }
    showError("");
    const { data, error } = await supabase.from("forloeb_parents")
      .insert({ forloeb_id: c.id, name: text(v.name), email }).select("id").single();
    if (error) { showError(`Forælderen kunne ikke gemmes: ${error.message}`); return; }
    await sendInvite(data.id, email);
  } else if (form.id === "plan-form") {
    await write(
      supabase.from("forloeb").update({
        student: text(v.student), grade: text(v.grade), subject: text(v.subject), goal: text(v.goal),
        next_date: v.date || null, next_time: v.time || null,
      }).eq("id", c.id),
      "Gemt. Forældresiden er opdateret.",
    );
  } else if (form.id === "session-form") {
    const fields = {
      held_on: v.date, hours: Number(v.hours), level: Number(v.level || 3),
      topic: text(v.topic), worked: text(v.worked), good: text(v.good), next_step: text(v.next),
    };
    const editing = editingSessionId;
    const request = editing
      ? supabase.from("forloeb_sessions").update(fields).eq("id", editing)
      : supabase.from("forloeb_sessions").insert({ forloeb_id: c.id, ...fields });
    editingSessionId = null;
    const ok = await write(request, editing ? "Rapporten er rettet." : "Rapporten er gemt og ligger nu på forældresiden.");
    if (!ok) { editingSessionId = editing; }
  }
}

$("detail").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const c = active();
  const { action, id, email } = button.dataset;

  if (action === "cancel-new") { mode = "view"; render(); return; }
  if (await handleInvoiceClick(action, button, ui)) return;
  if (!c) return;

  if (action === "resend") {
    button.disabled = true;
    await sendInvite(id, email);
    if (button.isConnected) button.disabled = false;
  } else if (action === "del-parent") {
    if (!confirm(`Fjern adgangen for ${email}? De kan ikke længere se forløbet.`)) return;
    await write(supabase.from("forloeb_parents").delete().eq("id", id), "Adgangen er fjernet.");
  } else if (action === "del-package") {
    if (!confirm("Fjern denne timepakke?")) return;
    await write(supabase.from("forloeb_packages").delete().eq("id", id));
  } else if (action === "edit-session") {
    editingSessionId = id;
    render();
    $("session-form").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "cancel-edit") {
    editingSessionId = null;
    render();
  } else if (action === "del-session") {
    if (!confirm("Slet denne rapport? Timerne lægges tilbage i pakken.")) return;
    await write(supabase.from("forloeb_sessions").delete().eq("id", id), "Rapporten er slettet.");
  } else if (action === "del-customer") {
    if (!confirm(`Slet hele forløbet for ${c.student}, inklusive alle rapporter? Det kan ikke fortrydes.`)) return;
    activeId = null;
    await write(supabase.from("forloeb").delete().eq("id", c.id), "Forløbet er slettet.");
  }
});

/* ---------- Start ---------- */

async function start() {
  const { data: { session } } = await supabase.auth.getSession();
  let isAdmin = false;
  if (session) {
    const { data } = await supabase.rpc("is_admin");
    isAdmin = data === true;
  }
  $("loading").hidden = true;
  if (!isAdmin) {
    if (session) $("gate-text").textContent = `${session.user.email} har ikke adgang til backend. Log ind med admin-kontoen.`;
    $("gate").hidden = false;
    return;
  }
  $("who").textContent = session.user.email || "";
  $("app").hidden = false;
  await load();
}

start();
