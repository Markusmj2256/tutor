/* Fakturering i /forloeb-admin: kortet "Fakturaer" på hver kunde og siden
 * "Fakturaoplysninger".
 *
 * Selve fakturaen (nummer, beløb, PDF og mail) laves af edge-funktionen
 * faktura. Denne fil viser kun formularen og listen, og den må kun selv
 * skrive to ting: ejerens fakturaoplysninger og "betalt den". */

import { supabase, today, fmtDate, fmtNum, fmtHours, esc } from "./forloeb-common.js";

// Samme priser som på lokaltutor.dk og i supabase/functions/faktura/faktura.ts.
const PACKAGES = {
  p20: { title: "20 timer", price: 350, hours: 20, min: 20 },
  p40: { title: "40 timer eller mere", price: 325, hours: 40, min: 40 },
  enkelt: { title: "Gang til gang", price: 400, hours: 2, min: 0 },
};

let invoices = [];
let settings = null;
let available = false;

const krFmt = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const kr = (n) => `${krFmt.format(Number(n))} kr.`;

export async function loadInvoices() {
  const [inv, set] = await Promise.all([
    supabase.from("fakturaer")
      .select("id, number, kind, credits, forloeb_id, issued_on, due_on, student, recipient_name, recipient_email, hours, total, sent_at, paid_on")
      .order("number", { ascending: false }),
    supabase.from("faktura_settings").select("*").maybeSingle(),
  ]);
  // Før databasen er sat op, findes tabellerne ikke. Så skjules faktureringen.
  available = !inv.error && !set.error && !!set.data;
  invoices = available ? inv.data || [] : [];
  settings = available ? set.data : null;
}

export const invoicingAvailable = () => available;

/* Det, der mangler i fakturaoplysningerne, før der kan udstedes en faktura. */
function missing() {
  const s = settings || {};
  const out = [];
  if (!s.address || !s.zip_city) out.push("adresse");
  if (!((s.bank_reg && s.bank_account) || s.mobilepay)) out.push("kontonummer eller MobilePay-nummer");
  return out;
}

const creditedIds = () => new Set(invoices.filter((i) => i.credits).map((i) => i.credits));

function status(inv, credited) {
  if (inv.kind === "kreditnota") return { kind: "plan", text: inv.sent_at ? "Kreditnota sendt" : "Kreditnota, ikke sendt", open: false };
  if (credited.has(inv.id)) return { kind: "", text: "Krediteret", open: false };
  if (inv.paid_on) return { kind: "ok", text: `Betalt ${fmtDate(inv.paid_on)}`, open: false };
  if (!inv.sent_at) return { kind: "report", text: "Ikke sendt", open: true };
  if (inv.due_on < today()) return { kind: "report", text: `Forfalden ${fmtDate(inv.due_on)}`, open: true };
  return { kind: "plan", text: `Afventer betaling · forfalder ${fmtDate(inv.due_on)}`, open: true };
}

export function invoiceStat() {
  if (!available) return "";
  const credited = creditedIds();
  const open = invoices.filter((i) => status(i, credited).open);
  const overdue = open.some((i) => i.sent_at && i.due_on < today());
  const sum = open.reduce((total, i) => total + Number(i.total), 0);
  return `<div class="stat${overdue ? " alert" : ""}"><b>${esc(krFmt.format(sum))}</b><span>kr. i ${open.length} ubetalte ${open.length === 1 ? "faktura" : "fakturaer"}</span></div>`;
}

/* ---------- Kortet på kunden ---------- */

export function invoiceCard(c) {
  if (!available) return "";
  const credited = creditedIds();
  const mine = invoices.filter((i) => i.forloeb_id === c.id);
  const lacks = missing();
  const first = c.parents[0];

  const list = mine.map((inv) => {
    const st = status(inv, credited);
    const isInvoice = inv.kind === "faktura";
    const live = isInvoice && !credited.has(inv.id);
    return `
      <div class="row">
        <span><strong>${isInvoice ? "Faktura" : "Kreditnota"} ${esc(inv.number)}</strong> · ${esc(kr(inv.total))}
          <br><span class="small muted">${esc(fmtDate(inv.issued_on))} · ${isInvoice ? `${esc(fmtHours(Number(inv.hours)))} · ` : ""}${esc(inv.recipient_email)}</span>
          <br><span class="chip ${st.kind}">${esc(st.text)}</span></span>
        <span class="row-actions">
          <button class="button-link" type="button" data-action="inv-pdf" data-id="${esc(inv.id)}">Åbn PDF</button>
          <button class="button-link" type="button" data-action="inv-send" data-id="${esc(inv.id)}" data-email="${esc(inv.recipient_email)}">${inv.sent_at ? "Send igen" : "Send"}</button>
          ${live ? (inv.paid_on
            ? `<button class="button-link" type="button" data-action="inv-unpaid" data-id="${esc(inv.id)}">Fortryd betalt</button>`
            : `<button class="button-link" type="button" data-action="inv-paid" data-id="${esc(inv.id)}">Markér betalt</button>`) : ""}
          ${live ? `<button class="button-link danger" type="button" data-action="inv-credit" data-id="${esc(inv.id)}" data-number="${esc(inv.number)}" data-email="${esc(inv.recipient_email)}">Kreditér</button>` : ""}
        </span>
      </div>`;
  }).join("");

  const form = !first
    ? `<p class="notice notice-info">Giv først en forælder adgang herover. Fakturaen sendes til forælderens mail.</p>`
    : `
    <form id="invoice-form">
      <div class="pick" role="radiogroup" aria-label="Pakke">
        ${Object.entries(PACKAGES).map(([key, p], i) => `
          <label><input type="radio" name="package" value="${key}" ${i === 0 ? "checked" : ""}>
            <span><strong>${esc(p.title)}</strong>${p.price} kr./time</span></label>`).join("")}
      </div>
      <div class="form-grid" style="margin-top:14px">
        <label class="field">Antal timer<input type="number" name="hours" value="20" min="0.5" max="500" step="0.5" required></label>
        <label class="field">Sendes til
          <select name="parent_id">${c.parents.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.email)}</option>`).join("")}</select>
        </label>
        <label class="field span-all">Modtagerens adresse (valgfri, adskil med komma)<input name="recipient_address" maxlength="200" placeholder="Vejnavn 1, 2800 Kgs. Lyngby" autocomplete="off"></label>
      </div>
      <details class="inline">
        <summary>+ Tillæg eller rabat</summary>
        <div class="form-grid">
          <label class="field">Tekst på fakturaen<input name="extra_text" maxlength="80" placeholder="F.eks. Transporttillæg"></label>
          <label class="field">Beløb i kr. (minus for rabat)<input type="number" name="extra_amount" step="1" min="-100000" max="100000" placeholder="0"></label>
        </div>
      </details>
      <label style="display:flex;gap:10px;align-items:center;font-size:0.9rem;margin-top:14px">
        <input type="checkbox" name="add_package" style="width:auto"> Læg også timerne ind på forløbet som en ny timepakke
      </label>
      <p class="invoice-total" id="invoice-total" aria-live="polite"></p>
      ${lacks.length ? `<p class="notice notice-warn">Du mangler at udfylde ${esc(lacks.join(" og "))}. <button class="button-link" type="button" data-action="open-settings">Udfyld fakturaoplysninger</button> – indtil da kan du kun se en forhåndsvisning.</p>` : ""}
      <div class="form-actions">
        <button class="button button-primary" type="submit" name="do" value="send" ${lacks.length ? "disabled" : ""}>Send faktura</button>
        <button class="button button-ghost" type="submit" name="do" value="preview">Forhåndsvis</button>
        <button class="button-link" type="submit" name="do" value="issue" ${lacks.length ? "disabled" : ""}>Opret uden at sende</button>
      </div>
    </form>`;

  return `
    <section class="card" id="invoice-card">
      <div class="card-head">
        <h2>Fakturaer</h2>
        <button class="button-link" type="button" data-action="open-settings">Fakturaoplysninger</button>
      </div>
      ${mine.length ? `<div class="rows">${list}</div>` : `<p class="muted small">Ingen fakturaer til ${esc(c.student)} endnu.</p>`}
      <details class="inline"${mine.length ? "" : " open"}>
        <summary>+ Ny faktura</summary>
        ${form}
      </details>
    </section>`;
}

/* Opdaterer "20 timer à 350 kr. = 7.000 kr." mens der tastes. */
export function refreshInvoiceTotal(changed) {
  const form = document.getElementById("invoice-form");
  if (!form) return;
  const pkg = PACKAGES[form.elements.package.value];
  if (changed && changed.name === "package") form.elements.hours.value = pkg.hours;
  const hours = Number(form.elements.hours.value) || 0;
  const extra = Number(form.elements.extra_amount.value) || 0;
  const total = hours * pkg.price + extra;
  const parts = [`${fmtHours(hours)} à ${pkg.price} kr.`];
  if (extra) parts.push(`${extra > 0 ? "+" : "−"} ${kr(Math.abs(extra))}`);
  const hint = pkg.min && hours < pkg.min ? ` <span class="muted small">Prisen ${pkg.price} kr. gælder normalt fra ${pkg.min} timer.</span>` : "";
  document.getElementById("invoice-total").innerHTML =
    `<span class="muted">${esc(parts.join(" "))} =</span> <strong>${esc(kr(total))}</strong>${hint}`;
}

/* ---------- Fakturaoplysninger ---------- */

export function settingsForm() {
  const s = settings || {};
  const field = (name, label, attrs = "", cls = "") =>
    `<label class="field ${cls}">${label}<input name="${name}" value="${esc(s[name] ?? "")}" ${attrs}></label>`;
  return `
    <form id="invoice-settings-form" class="card">
      <p class="kicker">Fakturering</p>
      <h1 style="font-size:1.7rem;margin-bottom:6px">Fakturaoplysninger</h1>
      <p class="muted" style="margin-bottom:18px">Står på alle nye fakturaer. Fakturaer, der allerede er udstedt, ændres ikke.</p>
      <div class="form-grid">
        ${field("seller_name", "Virksomhedens navn", 'required maxlength="120"')}
        ${field("cvr", "CVR-nummer", 'required maxlength="20" inputmode="numeric"')}
        ${field("address", "Adresse", 'required maxlength="120" placeholder="Vejnavn og nummer"')}
        ${field("zip_city", "Postnummer og by", 'required maxlength="80" placeholder="2820 Gentofte"')}
        ${field("email", "Mail (svar og kopi af fakturaer havner her)", 'type="email" maxlength="200"')}
        ${field("phone", "Telefon", 'maxlength="40"')}
      </div>
      <h2 style="margin-top:22px">Betaling</h2>
      <div class="form-grid">
        ${field("bank_reg", "Reg.nr.", 'maxlength="4" pattern="[0-9]{4}" inputmode="numeric" placeholder="4 cifre"')}
        ${field("bank_account", "Kontonummer", 'maxlength="14" pattern="[0-9 ]{6,14}" inputmode="numeric"')}
        ${field("mobilepay", "MobilePay-nummer (valgfrit)", 'maxlength="20" placeholder="Telefon- eller boksnummer"')}
        ${field("payment_days", "Betalingsfrist i dage", 'type="number" min="0" max="90" required')}
      </div>
      <h2 style="margin-top:22px">Moms og nummerering</h2>
      <div class="form-grid">
        <label class="field">Moms
          <select name="vat_rate">
            <option value="0" ${Number(s.vat_rate) === 0 ? "selected" : ""}>Ingen moms på fakturaen</option>
            <option value="25" ${Number(s.vat_rate) === 25 ? "selected" : ""}>25 % moms, indeholdt i prisen</option>
          </select>
        </label>
        ${field("first_number", "Første fakturanummer", 'type="number" min="1" max="9999999" required')}
        ${field("vat_note", "Tekst om moms nederst på fakturaen (valgfri)", 'maxlength="200"', "span-all")}
      </div>
      <p class="small muted" style="margin-top:8px">Spørg din revisor eller Skattestyrelsen, hvad der skal stå om moms. Numrene fortsætter fra den seneste faktura; "første fakturanummer" bruges kun, hvis det er højere.</p>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Gem</button>
        <button class="button button-ghost" type="button" data-action="close-settings">Tilbage</button>
      </div>
    </form>`;
}

/* ---------- Handlinger ---------- */

async function call(body) {
  const { data, error } = await supabase.functions.invoke("faktura", { body });
  if (!error) return data || {};
  let detail = "";
  try { detail = (await error.context.json()).error || ""; } catch { /* intet svar at læse */ }
  return { error: detail || "Fakturafunktionen svarede ikke" };
}

/* Et vindue skal åbnes, mens klikket stadig er "friskt", ellers blokerer browseren det. */
const openTab = () => window.open("", "_blank");
function showPdf(win, result) {
  const bytes = Uint8Array.from(atob(result.pdf), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  if (win && !win.closed) { win.location.href = url; return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename || "faktura.pdf";
  a.click();
}

/* Returnerer true, hvis formularen var en af fakturaformularerne. */
export async function handleInvoiceSubmit(form, v, c, submitter, ui) {
  if (form.id === "invoice-settings-form") {
    const fields = {
      seller_name: v.seller_name.trim(), cvr: v.cvr.trim(), address: v.address.trim(), zip_city: v.zip_city.trim(),
      email: v.email.trim().toLowerCase(), phone: v.phone.trim(),
      bank_reg: v.bank_reg.trim(), bank_account: v.bank_account.trim(), mobilepay: v.mobilepay.trim(),
      payment_days: Number(v.payment_days), vat_rate: Number(v.vat_rate), vat_note: v.vat_note.trim(),
      first_number: Number(v.first_number), updated_at: new Date().toISOString(),
    };
    ui.showError("");
    const { error } = await supabase.from("faktura_settings").update(fields).eq("id", true);
    if (error) { ui.showError(`Oplysningerne kunne ikke gemmes: ${error.message}`); return true; }
    ui.setMode("view");
    await ui.reload();
    ui.toast("Fakturaoplysningerne er gemt.");
    return true;
  }
  if (form.id !== "invoice-form") return false;

  const what = submitter ? submitter.value : "preview";
  const parent = c.parents.find((p) => p.id === v.parent_id);
  const invoice = {
    forloeb_id: c.id, parent_id: v.parent_id, package: v.package, hours: Number(v.hours),
    extra_text: v.extra_text, extra_amount: v.extra_amount === "" ? 0 : Number(v.extra_amount),
    recipient_address: v.recipient_address,
  };
  ui.showError("");

  if (what === "preview") {
    const win = openTab();
    const result = await call({ action: "preview", invoice });
    if (result.error) { if (win) win.close(); ui.showError(`Forhåndsvisningen kunne ikke laves: ${result.error}`); return true; }
    showPdf(win, result);
    return true;
  }

  const send = what === "send";
  const pkg = PACKAGES[v.package];
  const total = invoice.hours * pkg.price + invoice.extra_amount;
  const question = send
    ? `Send en faktura på ${kr(total)} til ${parent.email}?\n\nFakturaen får et nummer og kan ikke rettes bagefter.`
    : `Opret en faktura på ${kr(total)} uden at sende den?\n\nFakturaen får et nummer og kan ikke rettes bagefter.`;
  if (!confirm(question)) return true;

  const result = await call({ action: "issue", invoice, send, add_package: !!v.add_package });
  if (result.error) { ui.showError(`Fakturaen blev ikke oprettet: ${result.error}`); return true; }
  await ui.reload();
  if (send && !result.sent) {
    ui.showError(`Faktura ${result.number} er oprettet, men mailen blev ikke sendt${result.mail_error ? `: ${result.mail_error}` : ""}. Tryk "Send" ud for fakturaen for at prøve igen.`);
  } else {
    ui.toast(send ? `Faktura ${result.number} er sendt til ${parent.email}.` : `Faktura ${result.number} er oprettet. Den er ikke sendt endnu.`);
  }
  return true;
}

/* Returnerer true, hvis klikket hørte til faktureringen. */
export async function handleInvoiceClick(action, button, ui) {
  const { id, email, number } = button.dataset;

  if (action === "open-settings") { ui.setMode("settings"); return true; }
  if (action === "close-settings") { ui.setMode("view"); return true; }
  if (!action.startsWith("inv-")) return false;

  ui.showError("");
  if (action === "inv-pdf") {
    const win = openTab();
    const result = await call({ action: "pdf", id });
    if (result.error) { if (win) win.close(); ui.showError(`PDF'en kunne ikke hentes: ${result.error}`); return true; }
    showPdf(win, result);
  } else if (action === "inv-send") {
    if (!confirm(`Send den til ${email}?`)) return true;
    button.disabled = true;
    const result = await call({ action: "send", id });
    if (button.isConnected) button.disabled = false;
    if (result.error || !result.sent) { ui.showError(`Mailen blev ikke sendt: ${result.error || result.mail_error || "ukendt fejl"}`); return true; }
    await ui.reload();
    ui.toast(`Sendt til ${email}.`);
  } else if (action === "inv-paid" || action === "inv-unpaid") {
    const { error } = await supabase.from("fakturaer").update({ paid_on: action === "inv-paid" ? today() : null }).eq("id", id);
    if (error) { ui.showError(`Det kunne ikke gemmes: ${error.message}`); return true; }
    await ui.reload();
    ui.toast(action === "inv-paid" ? "Fakturaen er markeret som betalt." : "Fakturaen står som ubetalt igen.");
  } else if (action === "inv-credit") {
    if (!confirm(`Kreditér faktura ${number}?\n\nDer oprettes en kreditnota, som ophæver hele fakturaen og sendes til ${email}. Timer, du har lagt ind på forløbet, skal du selv fjerne.`)) return true;
    const result = await call({ action: "credit", id, send: true });
    if (result.error) { ui.showError(`Kreditnotaen blev ikke oprettet: ${result.error}`); return true; }
    await ui.reload();
    if (result.sent) ui.toast(`Kreditnota ${result.number} er sendt til ${email}.`);
    else ui.showError(`Kreditnota ${result.number} er oprettet, men mailen blev ikke sendt. Tryk "Send" ud for den.`);
  }
  return true;
}
