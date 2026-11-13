// Fakturering fra /forloeb-admin. Alle kald kræver en indlogget admin.
//
//   { action: "preview", invoice }             — PDF af en kladde. Intet gemmes.
//   { action: "issue", invoice, send, add_package }
//                                              — udsteder fakturaen (får nummer),
//                                                sender den evt. på mail og lægger
//                                                evt. timerne ind på forløbet.
//   { action: "send", id }                     — sender en udstedt faktura (igen).
//   { action: "pdf", id }                      — PDF af en udstedt faktura.
//   { action: "credit", id, send }             — udsteder en kreditnota på hele fakturaen.
//
// invoice = { forloeb_id, parent_id, package, hours, extra_text, extra_amount, recipient_address }
//
// En udstedt faktura rettes aldrig. Nummeret tildeles af databasen
// (fortløbende, uden huller), og sælgers oplysninger kopieres ind på rækken.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import * as PDFLib from "npm:pdf-lib@1.17.1";
import { buildCredit, buildInvoice, fileName, kr, longDate, missingSettings, num, todayDK } from "./faktura.ts";
import { buildPdf } from "./pdf.ts";

const ALLOWED_ORIGINS = [
  "https://lokaltutor.dk",
  "https://www.lokaltutor.dk",
  "http://127.0.0.1:8099",
  "http://localhost:8099",
];
const PRODUCTION = "https://lokaltutor.dk";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("FAKTURA_FROM") ?? "Markus Johnsen <faktura@lokaltutor.dk>";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL") ?? "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// deno-lint-ignore no-explicit-any
type Row = any;

/** Mailen til kunden. Returnerer en fejltekst, eller null hvis den blev sendt. */
async function sendMail(inv: Row, pdf: Uint8Array): Promise<string | null> {
  if (!RESEND_API_KEY) return "Mailnøglen mangler i Supabase";
  const credit = inv.kind === "kreditnota";
  const s = inv.seller ?? {};
  const name = firstName(inv.recipient_name);
  const hours = `${num(Math.abs(Number(inv.hours)))} ${Math.abs(Number(inv.hours)) === 1 ? "time" : "timer"}`;
  const subject = credit
    ? `Kreditnota ${inv.number} fra Lokaltutor`
    : `Faktura ${inv.number} fra Lokaltutor – ${kr(Number(inv.total))}`;

  const pay: string[] = [];
  if (s.bank_reg && s.bank_account) pay.push(`Bankoverførsel: reg. ${s.bank_reg}, konto ${s.bank_account}`);
  if (s.mobilepay) pay.push(`MobilePay: ${s.mobilepay}`);

  const intro = credit
    ? `Vedhæftet er en kreditnota, som ophæver faktura ${inv.credits_number}. Beløbet på ${kr(Math.abs(Number(inv.total)))} modregnes eller betales tilbage efter aftale.`
    : `Vedhæftet er fakturaen for ${hours}s undervisning til ${inv.student}.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.6;color:#1b2420;max-width:520px">
      <p>Hej ${escapeHtml(name)}</p>
      <p>${escapeHtml(intro)}</p>
      ${credit ? "" : `
      <table style="border-collapse:collapse;margin:22px 0;background:#e2eadb;border-radius:14px;width:100%">
        <tr><td style="padding:18px 20px">
          <div style="font-size:13px;color:#59625b">Faktura ${inv.number} · betales senest ${escapeHtml(longDate(inv.due_on))}</div>
          <div style="font-size:26px;font-weight:700;color:#1f4d3a;margin:2px 0 10px">${escapeHtml(kr(Number(inv.total)))}</div>
          ${pay.map((p) => `<div>${escapeHtml(p)}</div>`).join("")}
          <div style="font-size:13px;color:#59625b;margin-top:8px">Skriv fakturanr. ${inv.number} i beskeden.</div>
        </td></tr>
      </table>`}
      <p>Skriv eller ring endelig, hvis der er spørgsmål${s.phone ? ` – ${escapeHtml(s.phone)}` : ""}.</p>
      <p>Venlig hilsen<br>Markus Johnsen</p>
      <p style="color:#59625b;font-size:13px">${escapeHtml([s.seller_name, s.cvr && `CVR ${s.cvr}`].filter(Boolean).join(" · "))}</p>
    </div>`;
  const text = [
    `Hej ${name}`, "", intro, "",
    ...(credit ? [] : [
      `Faktura ${inv.number}: ${kr(Number(inv.total))}`,
      `Betales senest ${longDate(inv.due_on)}`,
      ...pay, `Skriv fakturanr. ${inv.number} i beskeden.`, "",
    ]),
    "Venlig hilsen", "Markus Johnsen",
  ].join("\n");

  const copy = s.email || NOTIFY_EMAIL;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [inv.recipient_email], subject, html, text,
        ...(copy ? { reply_to: copy, bcc: [copy] } : {}),
        attachments: [{ filename: fileName(inv), content: toBase64(pdf) }],
      }),
    });
    if (res.ok) return null;
    console.error("Resend afviste fakturamailen:", res.status, await res.text());
    return "Mailen kunne ikke sendes";
  } catch (err) {
    console.error("Kunne ikke sende fakturamail:", err);
    return "Mailen kunne ikke sendes";
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const allowed = !!origin && ALLOWED_ORIGINS.includes(origin);
  const cors = {
    "Access-Control-Allow-Origin": allowed ? origin! : PRODUCTION,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Kun POST" }, 405);
  if (!allowed) return json({ error: "Ukendt oprindelse" }, 403);
  if (Number(req.headers.get("content-length")) > 4000) return json({ error: "For stor forespørgsel" }, 413);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Kun en indlogget admin må fakturere.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  const callerEmail = userData?.user?.email_confirmed_at ? userData.user.email?.toLowerCase() : null;
  if (!callerEmail) return json({ error: "Log ind igen" }, 401);
  const { data: admins } = await supabase.from("admin_emails").select("email");
  const isAdmin = (admins ?? []).some((row: { email: string }) => row.email.toLowerCase() === callerEmail);
  if (!isAdmin) return json({ error: "Ingen adgang" }, 403);

  const action = body.action;
  const pdfResponse = async (inv: Row, draft = false) =>
    json({ ok: true, filename: fileName(inv), pdf: toBase64(await buildPdf(PDFLib, inv, { draft })) });

  /** En udstedt faktura med nummeret på den faktura, en kreditnota vedrører. */
  const loadInvoice = async (id: string): Promise<Row | null> => {
    const { data } = await supabase.from("fakturaer").select("*").eq("id", id).maybeSingle();
    if (!data) return null;
    if (data.credits) {
      const { data: orig } = await supabase.from("fakturaer").select("number").eq("id", data.credits).maybeSingle();
      data.credits_number = orig?.number ?? null;
    }
    return data;
  };
  /** Sender og noterer tidspunktet. Returnerer svaret til klienten. */
  const sendAndMark = async (inv: Row) => {
    const mailError = await sendMail(inv, await buildPdf(PDFLib, inv));
    if (mailError) return json({ ok: true, id: inv.id, number: inv.number, sent: false, mail_error: mailError });
    await supabase.from("fakturaer").update({ sent_at: new Date().toISOString() }).eq("id", inv.id);
    return json({ ok: true, id: inv.id, number: inv.number, sent: true });
  };

  if (action === "preview" || action === "issue") {
    const input = (body.invoice ?? {}) as Record<string, unknown>;
    if (!isId(input.forloeb_id) || !isId(input.parent_id)) return json({ error: "Mangler kunde eller modtager" }, 400);

    const [{ data: forloeb }, { data: parent }, { data: settings }] = await Promise.all([
      supabase.from("forloeb").select("id, student, subject").eq("id", input.forloeb_id).maybeSingle(),
      supabase.from("forloeb_parents").select("name, email, forloeb_id").eq("id", input.parent_id).maybeSingle(),
      supabase.from("faktura_settings").select("*").maybeSingle(),
    ]);
    if (!forloeb) return json({ error: "Forløbet findes ikke" }, 404);
    if (!parent || parent.forloeb_id !== forloeb.id) return json({ error: "Modtageren hører ikke til forløbet" }, 400);
    if (!settings) return json({ error: "Fakturaoplysningerne mangler i databasen" }, 500);

    const built = buildInvoice(input, { forloeb, parent, settings, today: todayDK() });
    if ("error" in built) return json({ error: built.error }, 400);
    if (action === "preview") return pdfResponse(built.row, true);

    const missing = missingSettings(settings);
    if (missing.length) return json({ error: `Udfyld først fakturaoplysninger: ${missing.join(", ")}` }, 400);

    const { number: _unused, ...row } = built.row;
    const { data: saved, error } = await supabase.from("fakturaer").insert(row).select("*").single();
    if (error || !saved) {
      console.error("Kunne ikke gemme fakturaen:", error?.message);
      return json({ error: "Fakturaen kunne ikke gemmes" }, 500);
    }
    if (body.add_package === true) {
      const { error: pkgError } = await supabase.from("forloeb_packages")
        .insert({ forloeb_id: forloeb.id, hours: saved.hours, bought_on: saved.issued_on });
      if (pkgError) console.error("Timerne blev ikke lagt ind:", pkgError.message);
    }
    if (body.send !== true) return json({ ok: true, id: saved.id, number: saved.number, sent: false });
    return sendAndMark(saved);
  }

  if (action === "send" || action === "pdf" || action === "credit") {
    if (!isId(body.id)) return json({ error: "Mangler faktura" }, 400);
    const inv = await loadInvoice(body.id);
    if (!inv) return json({ error: "Fakturaen findes ikke" }, 404);
    if (action === "pdf") return pdfResponse(inv);
    if (action === "send") return sendAndMark(inv);

    if (inv.kind !== "faktura") return json({ error: "En kreditnota kan ikke krediteres" }, 400);
    const { credits_number, ...row } = buildCredit(inv, todayDK());
    const { number: _n, ...insertRow } = row;
    const { data: saved, error } = await supabase.from("fakturaer").insert(insertRow).select("*").single();
    if (error || !saved) {
      const taken = error?.code === "23505";
      if (!taken) console.error("Kunne ikke gemme kreditnotaen:", error?.message);
      return json({ error: taken ? "Fakturaen er allerede krediteret" : "Kreditnotaen kunne ikke gemmes" }, taken ? 409 : 500);
    }
    saved.credits_number = credits_number;
    if (body.send !== true) return json({ ok: true, id: saved.id, number: saved.number, sent: false });
    return sendAndMark(saved);
  }

  return json({ error: "Ukendt handling" }, 400);
});
