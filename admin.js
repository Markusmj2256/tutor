/* Admin-side for lokaltutor — viser henvendelser fra kontaktformularerne.
 *
 * Adgangen styres af row level security i databasen, ikke af denne fil.
 * Anon-nøglen herunder er offentlig; uden en indlogget bruger, hvis mail
 * står i tabellen admin_emails, returnerer forespørgslerne ingenting.
 *
 * Alt indhold fra formularerne indsættes med textContent, aldrig innerHTML,
 * så en indsendt besked ikke kan køre kode på denne side. */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://kslmcjkyhxdevdfyzzrb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbG1jamt5aHhkZXZkZnl6enJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Mzc4NDIsImV4cCI6MjEwMTAxMzg0Mn0.lP-uPzYevRcKCos3wOQVB56XjrDgWrHqXJtSt1x-300";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginButton = $("login-button");
const app = $("app");
const appError = $("app-error");
const list = $("list");
const empty = $("empty");

const SOURCE_LABEL = { hold: "Hold", ene: "1:1", forside: "Forside" };
const STATUS_LABEL = {
  ny: "Ny",
  kontaktet: "Kontaktet",
  tilmeldt: "Tilmeldt",
  lukket: "Lukket",
};

let leads = [];
let flyerRows = [];
let leadFlyers = new Map();
let filterStatus = "";
const openRows = new Set();

/* ---------- Hjælpere ---------- */

const dateFormat = new Intl.DateTimeFormat("da-DK", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "—");

function showError(node, message, variant = "error") {
  node.className = `notice notice-${variant}`;
  node.textContent = message;
  node.hidden = false;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- Login ---------- */

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = "Logger ind…";

  const data = new FormData(loginForm);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(data.get("email") || "").trim(),
    password: String(data.get("password") || ""),
  });

  loginButton.disabled = false;
  loginButton.textContent = "Log ind";

  if (error) {
    showError(
      loginError,
      error.message === "Invalid login credentials"
        ? "Forkert mailadresse eller adgangskode."
        : `Kunne ikke logge ind: ${error.message}`,
    );
    return;
  }
  loginForm.reset();
  await start();
});

// Første gang skal kontoen oprettes. Det er ufarligt at lade knappen stå:
// en konto giver i sig selv ingen adgang — mailen skal stå i admin_emails,
// og row level security afviser alle andre.
$("signup-button").addEventListener("click", async () => {
  loginError.hidden = true;
  const data = new FormData(loginForm);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");

  if (!email || password.length < 8) {
    showError(loginError, "Udfyld mail og en adgangskode på mindst 8 tegn.");
    return;
  }

  const { data: result, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    showError(loginError, `Kunne ikke oprette adgang: ${error.message}`);
    return;
  }
  if (result.session) {
    await start();
    return;
  }
  showError(loginError, "Kontoen er oprettet. Bekræft den via mailen, og log så ind.", "ok");
});

$("logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  leads = [];
  flyerRows = [];
  leadFlyers.clear();
  $("flyer-results").replaceChildren();
  app.hidden = true;
  loginScreen.hidden = false;
});

/* ---------- Indlæsning ---------- */

async function start() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    app.hidden = true;
    loginScreen.hidden = false;
    return;
  }

  // Mailen skal stå i admin_emails, ellers giver kontoen ingen adgang.
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || !isAdmin) {
    await supabase.auth.signOut();
    loginScreen.hidden = false;
    app.hidden = true;
    showError(
      loginError,
      "Kontoen har ikke adgang til henvendelserne. Kontakt Markus, hvis det er en fejl.",
    );
    return;
  }

  loginScreen.hidden = true;
  app.hidden = false;
  $("who").textContent = session.user.email ?? "";
  await load();
}

async function load() {
  appError.hidden = true;
  const { data, error } = await supabase
    .from("tutor_leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    showError(appError, `Kunne ikke hente henvendelser: ${error.message}`);
    return;
  }
  leads = data ?? [];
  const attribution = await supabase.from("tutor_lead_flyers").select("*");
  leadFlyers = new Map((attribution.data ?? []).map((row) => [row.lead_id, row]));
  if (attribution.error) showError(appError, "Henvendelserne er hentet, men flyerkilderne kunne ikke hentes. Prøv Opdatér.");
  render();
  await loadFlyers();
}

$("refresh").addEventListener("click", load);

/* ---------- Filtrering og visning ---------- */

$("filter-source").addEventListener("change", render);
$("filter-flyer").addEventListener("change", render);
$("filter-search").addEventListener("input", render);

$("stats").addEventListener("click", (event) => {
  const button = event.target.closest(".stat");
  if (!button) return;
  filterStatus = button.dataset.status;
  document.querySelectorAll(".stat").forEach((s) =>
    s.setAttribute("aria-pressed", String(s === button)));
  render();
});

function visibleLeads() {
  const source = $("filter-source").value;
  const term = $("filter-search").value.trim().toLowerCase();
  return leads.filter((lead) => {
    const flyer = $("filter-flyer").value;
    const attributed = leadFlyers.get(lead.id);
    if (flyer === "none" && attributed) return false;
    if (flyer && flyer !== "none" && attributed?.flyer_id !== flyer) return false;
    if (filterStatus && lead.status !== filterStatus) return false;
    if (source && lead.source !== source) return false;
    if (!term) return true;
    return [lead.name, lead.email, lead.phone, lead.level, lead.subject, lead.package, lead.message, lead.notes]
      .some((v) => v && String(v).toLowerCase().includes(term));
  });
}

function render() {
  const counts = { ny: 0, kontaktet: 0, tilmeldt: 0 };
  leads.forEach((lead) => {
    if (lead.status in counts) counts[lead.status] += 1;
  });
  $("count-ny").textContent = counts.ny;
  $("count-kontaktet").textContent = counts.kontaktet;
  $("count-tilmeldt").textContent = counts.tilmeldt;
  $("count-alle").textContent = leads.length;

  const rows = visibleLeads();
  list.replaceChildren(...rows.map(renderLead));
  empty.hidden = rows.length > 0;
}

function renderLead(lead) {
  const card = el("article", "lead");
  const isOpen = openRows.has(lead.id);

  /* --- Sammenklappet række --- */
  const head = el("button", "lead-head");
  head.type = "button";
  head.setAttribute("aria-expanded", String(isOpen));

  const who = el("div");
  who.append(el("div", "lead-name", lead.name || "Uden navn"));
  const sub = el("div", "lead-sub", formatDate(lead.created_at));
  const attribution = leadFlyers.get(lead.id);
  if (attribution) sub.append(" · ", attribution.flyer_name);
  if ((lead.submissions ?? 1) > 1) {
    sub.append(" · ", el("span", "repeat-flag", `skrev ${lead.submissions} gange`));
  }
  who.append(sub);

  const contact = el("div", "lead-contact",
    [lead.phone, lead.email].filter(Boolean).join(" · ") || "Ingen kontaktoplysninger");

  const source = el("span", `badge badge-${lead.source}`,
    SOURCE_LABEL[lead.source] ?? lead.source);
  const status = el("span", `badge badge-${lead.status}`,
    STATUS_LABEL[lead.status] ?? lead.status);

  head.append(who, contact, source, status);
  head.addEventListener("click", () => {
    if (openRows.has(lead.id)) openRows.delete(lead.id);
    else openRows.add(lead.id);
    render();
  });
  card.append(head);

  if (!isOpen) return card;

  /* --- Udfoldet indhold --- */
  const body = el("div", "lead-body");
  const grid = el("dl", "detail-grid");
  const facts = [
    ["Klassetrin", lead.level],
    ["Fag", lead.subject],
    ["Pakke", lead.package],
    ["Formular", SOURCE_LABEL[lead.source] ?? lead.source],
    ["Flyer", leadFlyers.get(lead.id)?.flyer_name ?? "Ingen registreret flyer"],
    ["Modtaget", formatDate(lead.created_at)],
    ["Senest opdateret", formatDate(lead.updated_at)],
  ];
  if (lead.phone) facts.unshift(["Telefon", lead.phone, `tel:${lead.phone.replace(/\s/g, "")}`]);
  if (lead.email) facts.unshift(["Mail", lead.email, `mailto:${lead.email}`]);

  facts.forEach(([label, value, href]) => {
    if (!value) return;
    const cell = el("div");
    cell.append(el("dt", null, label));
    const dd = el("dd");
    if (href) {
      const link = el("a", null, value);
      link.href = href;
      dd.append(link);
    } else {
      dd.textContent = value;
    }
    cell.append(dd);
    grid.append(cell);
  });
  body.append(grid);

  if (lead.message) {
    body.append(el("dt", null, "Besked"));
    body.append(el("div", "message-box", lead.message));
  }

  /* --- Redigering --- */
  const row = el("div", "edit-row");

  const statusLabel = el("label", "field", "Status");
  const statusSelect = el("select");
  Object.entries(STATUS_LABEL).forEach(([value, label]) => {
    const option = el("option", null, label);
    option.value = value;
    if (lead.status === value) option.selected = true;
    statusSelect.append(option);
  });
  statusLabel.append(statusSelect);

  const notesLabel = el("label", "field", "Mine noter");
  const notesInput = el("textarea");
  notesInput.value = lead.notes ?? "";
  notesInput.placeholder = "Fx aftalt opstart, pris, eller hvad der blev sagt i telefonen";
  notesLabel.append(notesInput);

  const saveWrap = el("div");
  const save = el("button", "button button-primary", "Gem");
  save.type = "button";
  const saveState = el("span", "save-state");
  saveWrap.append(save, " ", saveState);

  save.addEventListener("click", async () => {
    save.disabled = true;
    saveState.textContent = "Gemmer…";
    const { error } = await supabase
      .from("tutor_leads")
      .update({ status: statusSelect.value, notes: notesInput.value.trim() || null })
      .eq("id", lead.id);
    save.disabled = false;

    if (error) {
      saveState.style.color = "#8a3b36";
      saveState.textContent = `Kunne ikke gemme: ${error.message}`;
      return;
    }
    saveState.style.color = "";
    saveState.textContent = "Gemt";
    lead.status = statusSelect.value;
    lead.notes = notesInput.value.trim() || null;
    await loadFlyers();
    setTimeout(render, 700);
  });

  row.append(statusLabel, notesLabel, saveWrap);
  body.append(row);
  card.append(body);
  return card;
}

/* ---------- CSV ---------- */

$("export").addEventListener("click", () => {
  const columns = [
    ["Modtaget", (l) => formatDate(l.created_at)],
    ["Formular", (l) => SOURCE_LABEL[l.source] ?? l.source],
    ["Flyer", (l) => leadFlyers.get(l.id)?.flyer_name],
    ["Status", (l) => STATUS_LABEL[l.status] ?? l.status],
    ["Navn", (l) => l.name],
    ["Telefon", (l) => l.phone],
    ["Mail", (l) => l.email],
    ["Klassetrin", (l) => l.level],
    ["Fag", (l) => l.subject],
    ["Pakke", (l) => l.package],
    ["Antal henvendelser", (l) => l.submissions],
    ["Besked", (l) => l.message],
    ["Noter", (l) => l.notes],
  ];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = visibleLeads();
  const csv = [
    columns.map(([title]) => escape(title)).join(";"),
    ...rows.map((lead) => columns.map(([, get]) => escape(get(lead))).join(";")),
  ].join("\r\n");

  // BOM foran, så Excel læser æ, ø og å rigtigt.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `henvendelser-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

/* ---------- Flyer funnel ---------- */
let flyerRequest = 0;
const percent = (value) => value == null ? "—" : `${Number(value).toLocaleString("da-DK", { maximumFractionDigits: 1 })} %`;
async function loadFlyers() {
  const request = ++flyerRequest;
  const days = $("flyer-period").value;
  $("flyer-message").textContent = "Henter flyerdata…";
  $("flyer-export").disabled = true;
  const { data, error } = await supabase.rpc("tutor_flyer_report", { p_days: days ? Number(days) : null });
  if (request !== flyerRequest) return;
  if (error) {
    flyerRows = [];
    $("flyer-results").replaceChildren();
    $("flyer-message").textContent = `Flyerdata kunne ikke hentes: ${error.message}. Prøv Opdatér.`;
    return;
  }
  flyerRows = data ?? [];
  $("flyer-results").replaceChildren(...flyerRows.map((row) => {
    const tr = el("tr");
    const name = el("td");
    name.append(el("div", "flyer-name", row.name));
    const link = el("a", null, "Åbn testlink ↗");
    const url = new URL(row.landing_path, "https://lokaltutor.vercel.app");
    url.searchParams.set("flyer", row.flyer_id);
    url.searchParams.set("tracking_test", "1");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    name.append(link);
    tr.append(name, ...[row.visits, row.new_leads, percent(row.contact_rate), row.enrolled_leads, percent(row.enrollment_rate)].map((v) => el("td", null, String(v))));
    return tr;
  }));
  const filter = $("filter-flyer");
  const selected = filter.value;
  filter.replaceChildren(...[["", "Alle flyers / øvrige"], ["none", "Uden flyer"], ...flyerRows.map((r) => [r.flyer_id, r.name])].map(([id, label]) => {
    const option = el("option", null, label); option.value = id; return option;
  }));
  filter.value = selected;
  $("flyer-message").textContent = flyerRows.some((r) => Number(r.visits) > 0)
    ? "Sammenlign raterne sammen med antal besøg. Et lille antal besøg kan give store udsving."
    : "Ingen registrerede flyerbesøg i perioden endnu. Testlinks nedenfor tæller ikke med.";
  $("flyer-export").disabled = false;
}
$("flyer-period").addEventListener("change", loadFlyers);
$("flyer-export").addEventListener("click", () => {
  const rows = [["Flyer", "Kode", "Besøgsperiode (dage)", "Besøg", "Nye henvendelser", "Konverterede besøg", "Kontakt-rate (%)", "Tilmeldte", "Besøg med tilmelding", "Tilmeldingsrate (%)"],
    ...flyerRows.map((r) => [r.name, r.flyer_id, $("flyer-period").value || "Alle", r.visits, r.new_leads, r.converted_visits, r.contact_rate, r.enrolled_leads, r.enrolled_visits, r.enrollment_rate])];
  const csv = rows.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = el("a"); link.href = url;
  link.download = `flyer-resultater-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click(); URL.revokeObjectURL(url);
});

/* ---------- Start ---------- */

start();
