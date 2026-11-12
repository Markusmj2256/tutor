/* Kundesiden: en forælder logger ind med et link på mail og følger sit barns
 * forløb. Siden kan kun læse; alt skrives fra forloeb-admin. */

import {
  supabase, FORLOEB_SELECT, toCustomer, stats, today,
  fmtDate, fmtDateLong, fmtNum, fmtHours, fmtTime, firstName, possessive, esc,
} from "./forloeb-common.js";

const $ = (id) => document.getElementById(id);

// Linket i mailen lander her med #login=<engangstoken>. Tokenet fjernes fra
// adresselinjen med det samme, så det ikke ligger i historikken.
let loginToken = null;
function takeLoginToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get("login");
  if (!token) return false;
  loginToken = token;
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}
takeLoginToken();

// Ejeren kan se en forælders side fra backend med ?vis=<forløbets id>.
const previewId = new URLSearchParams(location.search).get("vis");

let customers = [];
let customer = null;
let userEmail = "";
let selectedId = null;

function show(screen) {
  $("loading").hidden = screen !== "loading";
  $("login-screen").hidden = screen !== "login";
  $("app").hidden = screen !== "app";
}
function showStep(step) {
  ["login-step", "sent-step", "open-step"].forEach((id) => { $(id).hidden = id !== step; });
  show("login");
}
function notice(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

/* ---------- Login ---------- */

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  notice("login-error", "");
  const email = $("login-email").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    notice("login-error", "Skriv en gyldig mailadresse.");
    $("login-email").focus();
    return;
  }
  const button = $("login-button");
  button.disabled = true;
  button.textContent = "Sender…";
  const { error } = await supabase.functions.invoke("forloeb-login", { body: { email } });
  button.disabled = false;
  button.textContent = "Send mig et login-link";
  if (error) {
    const status = error.context && error.context.status;
    notice("login-error", status === 429
      ? "Der er bedt om for mange links på kort tid. Prøv igen om en time."
      : "Linket kunne ikke sendes lige nu. Prøv igen om lidt, eller skriv til Markus.");
    return;
  }
  $("sent-text").textContent = `Hvis ${email} er tilknyttet et forløb, ligger der et login-link i indbakken om et øjeblik. Linket virker i en time.`;
  showStep("sent-step");
});

$("back-to-login").addEventListener("click", () => showStep("login-step"));

$("open-button").addEventListener("click", async () => {
  const button = $("open-button");
  button.disabled = true;
  button.textContent = "Åbner…";
  notice("open-error", "");
  let { error } = await supabase.auth.verifyOtp({ token_hash: loginToken, type: "magiclink" });
  if (error) ({ error } = await supabase.auth.verifyOtp({ token_hash: loginToken, type: "email" }));
  button.disabled = false;
  button.textContent = "Åbn forløbet";
  if (error) {
    loginToken = null;
    showStep("login-step");
    notice("login-error", "Linket er udløbet eller allerede brugt. Skriv din mail herunder, så sender vi et nyt.");
    return;
  }
  loginToken = null;
  await start();
});

$("logout").addEventListener("click", async () => {
  if (previewId) { location.href = "forloeb-admin.html"; return; }
  await supabase.auth.signOut();
  customers = [];
  customer = null;
  showStep("login-step");
});

/* ---------- Forløbsvejen ---------- */

const STEP = 134;
const PAD = 84;
const HEIGHT = 320;
const MID = 160;
const AMP = 62;
const MAX_FUTURE = 6;

function clip(text, max) {
  const t = String(text || "");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
// To overlejrede bølger, så vejen buer op og ned uden at gentage sig stift.
function nodeY(i) {
  return MID - AMP * (Math.sin(i * 1.08 + 0.5) * 0.82 + Math.sin(i * 2.31) * 0.18);
}
function curve(points) {
  if (!points.length) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const h = (b.x - a.x) / 2;
    d += ` C ${a.x + h} ${a.y}, ${b.x - h} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

function renderRoad() {
  const sessions = customer.sessions;
  const st = stats(customer);
  const hasNext = customer.next.date && customer.next.date >= today() && st.left > 0;
  const futureCount = Math.min(MAX_FUTURE, Math.max(hasNext ? 1 : 0, st.sessionsLeft));

  const nodes = sessions.map((s, i) => ({ type: "done", s, n: i + 1 }));
  for (let i = 0; i < futureCount; i += 1) nodes.push({ type: i === 0 && hasNext ? "next" : "future" });
  nodes.push({ type: "goal" });
  nodes.forEach((node, i) => { node.x = PAD + i * STEP; node.y = Math.round(nodeY(i)); });

  const width = PAD * 2 + (nodes.length - 1) * STEP;
  const start = { x: 14, y: nodes[0].y + 18 };
  const doneNodes = nodes.filter((n) => n.type === "done");
  const done = doneNodes.length ? [start, ...doneNodes] : [];

  const label = (node, line1, line2) => {
    const y1 = node.y < MID ? node.y - 46 : node.y + 42;
    return `<text class="road-label" x="${node.x}" y="${y1}">${esc(line1)}</text>${
      line2 ? `<text class="road-sub" x="${node.x}" y="${y1 + 16}">${esc(line2)}</text>` : ""}`;
  };

  const parts = nodes.map((node) => {
    if (node.type === "done") {
      const s = node.s;
      return `<g class="road-node${s.id === selectedId ? " is-selected" : ""}" data-id="${esc(s.id)}" tabindex="0" role="button"
          aria-label="Gang ${node.n}, ${esc(fmtDateLong(s.date))}: ${esc(s.topic)}">
        <circle class="halo" cx="${node.x}" cy="${node.y}" r="25"></circle>
        <circle class="dot" cx="${node.x}" cy="${node.y}" r="17"></circle>
        <text class="num" x="${node.x}" y="${node.y}">${node.n}</text>
        ${label(node, fmtDate(s.date), clip(s.topic, 21))}
      </g>`;
    }
    if (node.type === "next") {
      return `<g class="road-next">
        <circle class="dot" cx="${node.x}" cy="${node.y}" r="15"></circle>
        ${label(node, "Næste gang", `${fmtDate(customer.next.date)} ${fmtTime(customer.next.time)}`.trim())}
      </g>`;
    }
    if (node.type === "future") {
      return `<circle class="road-future" cx="${node.x}" cy="${node.y}" r="8"></circle>`;
    }
    return `<g class="road-goal">
      <circle class="disc" cx="${node.x}" cy="${node.y}" r="20"></circle>
      <path class="flag" d="M ${node.x - 5} ${node.y - 10} v 20 h 2.4 v -8 l 10 -5 l -10 -5 v -2 z"></path>
      ${label(node, "Målet", clip(customer.goal, 22))}
    </g>`;
  });

  const scroller = $("road-scroll");
  scroller.innerHTML = `
    <svg width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="group" aria-label="Et punkt for hver undervisningsgang">
      <defs>
        <linearGradient id="roadGold" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#f2be6a"></stop><stop offset="1" stop-color="#c9811a"></stop>
        </linearGradient>
      </defs>
      <path class="road-track" d="${curve([start, ...nodes])}"></path>
      <path class="road-done-bg" d="${curve(done)}"></path>
      <path class="road-done" d="${curve(done)}"></path>
      ${parts.join("")}
    </svg>`;

  // Start med det seneste punkt i syne på smalle skærme.
  const last = doneNodes[doneNodes.length - 1];
  scroller.scrollLeft = last ? Math.max(0, last.x - scroller.clientWidth * 0.6) : 0;
}

function select(id, scrollToReport) {
  selectedId = id;
  document.querySelectorAll(".road-node").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.id === id);
  });
  renderReport();
  if (scrollToReport) $("report").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

$("road-scroll").addEventListener("click", (event) => {
  const node = event.target.closest(".road-node");
  if (node) select(node.dataset.id);
});
$("road-scroll").addEventListener("keydown", (event) => {
  const node = event.target.closest(".road-node");
  if (node && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    select(node.dataset.id);
  }
});

/* ---------- Rapport ---------- */

const LEVEL_TEXT = ["", "Helt nyt stof", "På vej", "Godt på vej", "Sidder godt", "Sidder helt fast"];

function block(title, text, extra = "") {
  return text ? `<div class="report-block${extra}"><h4>${title}</h4><p>${esc(text)}</p></div>` : "";
}

function renderReport() {
  const sessions = customer.sessions;
  const index = sessions.findIndex((s) => s.id === selectedId);
  const box = $("report");
  if (index < 0) {
    box.innerHTML = `<p class="muted">Der er ikke skrevet nogen rapport endnu. Den første kommer efter første undervisningsgang.</p>`;
    return;
  }
  const s = sessions[index];
  const dots = [1, 2, 3, 4, 5].map((n) => `<i class="${n <= s.level ? "on" : ""}"></i>`).join("");
  box.innerHTML = `
    <div class="report-head">
      <div>
        <p class="kicker">Gang ${index + 1} · ${esc(fmtDateLong(s.date))} · ${esc(fmtHours(s.hours))}</p>
        <h3>${esc(s.topic)}</h3>
      </div>
      <div class="report-nav">
        <button class="button button-ghost button-small" type="button" data-go="${index - 1}" ${index === 0 ? "disabled" : ""}>← Forrige</button>
        <button class="button button-ghost button-small" type="button" data-go="${index + 1}" ${index === sessions.length - 1 ? "disabled" : ""}>Næste →</button>
      </div>
    </div>
    <div class="report-grid">
      ${block("Det arbejdede vi med", s.worked)}
      ${block("Det gik godt", s.good, " good")}
      ${block("Til næste gang", s.next)}
    </div>
    ${s.level ? `<div class="level"><span class="level-dots" aria-hidden="true">${dots}</span><span>Forståelse af emnet: <strong>${esc(LEVEL_TEXT[s.level])}</strong></span></div>` : ""}`;
}
$("report").addEventListener("click", (event) => {
  const button = event.target.closest("[data-go]");
  if (!button || button.disabled) return;
  const target = customer.sessions[Number(button.dataset.go)];
  if (target) select(target.id);
});

/* ---------- Overblik og arkiv ---------- */

function renderSummary() {
  const st = stats(customer);
  const pct = st.bought ? Math.min(100, (st.used / st.bought) * 100) : 0;
  const low = st.left <= 3;
  const next = customer.next.date && customer.next.date >= today() ? customer.next : null;
  const count = customer.sessions.length;
  $("summary").innerHTML = `
    <div class="card">
      <p class="kicker">Timer</p>
      <p class="big-num">${esc(fmtNum(st.left))} <small>${st.left === 1 ? "time" : "timer"} tilbage</small></p>
      <div class="meter${low ? " low" : ""}" role="img" aria-label="${esc(fmtNum(st.used))} af ${esc(fmtNum(st.bought))} timer brugt"><span style="width:${pct}%"></span></div>
      <p class="small muted">${esc(fmtNum(st.used))} af ${esc(fmtNum(st.bought))} købte timer er brugt på ${count} ${count === 1 ? "gang" : "gange"}.</p>
      ${low ? `<p class="notice notice-info" style="margin-top:12px">${st.left === 0 ? "Pakken er brugt." : "Pakken er snart brugt."} Skriv til Markus, hvis I vil fortsætte.</p>` : ""}
    </div>
    <div class="card">
      <p class="kicker">Næste gang</p>
      ${next
        ? `<h3>${esc(fmtDateLong(next.date))}</h3><p class="muted">${esc(fmtTime(next.time) || "Tidspunkt aftales")}</p>`
        : `<h3>Ikke aftalt endnu</h3><p class="muted">Markus skriver, når næste gang er på plads.</p>`}
    </div>
    <div class="card">
      <p class="kicker">Målet</p>
      <h3>${esc(customer.goal || "Aftales sammen")}</h3>
      <p class="muted">${esc([customer.subject, customer.grade].filter(Boolean).join(", "))}</p>
    </div>`;
}

function renderList() {
  $("report-list").innerHTML = customer.sessions.map((s, i) => `
    <button class="report-row" type="button" data-id="${esc(s.id)}">
      <span class="n">${i + 1}</span>
      <span class="d">${esc(fmtDate(s.date))}</span>
      <span class="t">${esc(s.topic)}</span>
      <span class="h">${esc(fmtHours(s.hours))}</span>
    </button>`).reverse().join("") || `<p class="muted">Ingen rapporter endnu.</p>`;
}
$("report-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-id]");
  if (row) select(row.dataset.id, true);
});

// Har man flere børn i forløb, vælger man mellem dem her.
$("children").addEventListener("click", (event) => {
  const button = event.target.closest("[data-child]");
  if (!button) return;
  customer = customers.find((c) => c.id === button.dataset.child) || customer;
  selectedId = null;
  renderApp();
});

/* ---------- Start ---------- */

function renderApp() {
  const sessions = customer.sessions;
  if (!sessions.some((s) => s.id === selectedId)) {
    selectedId = sessions.length ? sessions[sessions.length - 1].id : null;
  }
  const me = customer.parents.find((p) => p.email === userEmail) || (previewId ? customer.parents[0] : null);
  $("who").textContent = me ? me.name : userEmail;
  $("hello-kicker").textContent = [customer.subject, customer.grade].filter(Boolean).join(" · ");
  $("hello-title").innerHTML = `${me ? `Hej ${esc(firstName(me.name))}. ` : ""}Sådan går det for <em>${esc(firstName(customer.student))}</em>`;
  const last = sessions[sessions.length - 1];
  $("hello-text").textContent = last
    ? `Seneste gang var ${fmtDateLong(last.date)}, hvor vi arbejdede med ${last.topic.charAt(0).toLowerCase() + last.topic.slice(1)}. Herunder kan I følge hele forløbet gang for gang.`
    : "Forløbet er oprettet. Efter første gang kan I læse en kort rapport her.";

  const tabs = $("children");
  tabs.hidden = customers.length < 2;
  tabs.innerHTML = customers.map((c) => (
    `<button type="button" data-child="${esc(c.id)}" aria-pressed="${c.id === customer.id}">${esc(firstName(c.student))}</button>`
  )).join("");

  renderSummary();
  renderRoad();
  renderReport();
  renderList();
}

async function start() {
  show("loading");
  const { data: { session } } = await supabase.auth.getSession();

  // Et nyt link fra mailen går forud for en gammel session, så en anden
  // forælder på samme enhed ikke havner i den forkertes forløb.
  if (loginToken) { showStep("open-step"); return; }
  if (!session) { showStep("login-step"); return; }
  userEmail = (session.user.email || "").toLowerCase();

  let query = supabase.from("forloeb").select(FORLOEB_SELECT).order("created_at");
  if (previewId) query = query.eq("id", previewId);
  const { data, error } = await query;
  if (error) {
    showStep("login-step");
    notice("login-error", "Forløbet kunne ikke hentes lige nu. Prøv igen om lidt.");
    return;
  }
  customers = (data || []).map(toCustomer);
  // Uden ?vis ser man kun de forløb, man selv står som forælder på — også
  // selvom man er admin og derfor må læse dem alle.
  if (!previewId) customers = customers.filter((c) => c.parents.some((p) => p.email === userEmail));

  if (!customers.length) {
    showStep("login-step");
    notice("login-error", previewId
      ? "Forløbet findes ikke, eller du har ikke adgang til det."
      : `${userEmail} er ikke tilknyttet et forløb. Skriv til Markus, hvis det er en fejl.`);
    return;
  }
  customer = customers.find((c) => customer && c.id === customer.id) || customers[0];

  if (previewId) {
    $("preview-banner").hidden = false;
    $("preview-banner").textContent = `Forhåndsvisning: sådan ser ${possessive(customer.student)} forældre siden.`;
    $("logout").textContent = "Tilbage til backend";
  } else {
    // Fortæller ejeren, at forælderen har været inde. Fejl her er ligegyldige for visningen.
    supabase.rpc("forloeb_touch_login").then(() => {}, () => {});
  }
  show("app");
  renderApp();
}

// Står siden allerede åben i fanen, når linket fra mailen åbnes, genindlæses
// den ikke; kun #-delen skifter.
window.addEventListener("hashchange", () => { if (takeLoginToken()) start(); });

start();
