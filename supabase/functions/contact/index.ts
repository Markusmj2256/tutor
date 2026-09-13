// Kontaktformular for lokaltutor-hjemmesiden.
//
// Tager imod en henvendelse fra en af de tre formularer, gemmer den i
// public.tutor_leads og sender en notifikationsmail til Markus.
//
// Henvendelsen gemmes ALTID først. Hvis mailen fejler, er beskeden derfor
// stadig registreret — en besked fra en familie må ikke gå tabt, fordi en
// mailtjeneste er nede.
//
// Værn mod spam og dubletter:
//   1. Honeypot   — et skjult felt som kun bots udfylder.
//   2. Tidskontrol — en formular udfyldt på under to sekunder er ikke menneskelig.
//   3. Rate limit  — højst 5 indsendelser i timen og 15 i døgnet pr. IP.
//   4. Dubletter   — databasefunktionen samler gentagne henvendelser fra samme
//                    person på samme formular i én række.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const ALLOWED_ORIGINS = [
  "https://lokaltutor.vercel.app",
  "https://lokaltutor-johsens.vercel.app",
  "https://lokaltutor-git-main-johsens.vercel.app",
  "https://markusmj2256.github.io",
  "https://lokaltutor.dk",
  "https://www.lokaltutor.dk",
  "http://127.0.0.1:8099",
  "http://localhost:8099",
];

// Vercels forhåndsvisninger får et nyt domæne ved hver deployment.
const PREVIEW_ORIGIN = /^https:\/\/lokaltutor-[a-z0-9]+-johsens\.vercel\.app$/;

const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 15;
const MIN_FILL_MS = 2000;

const NOTIFY_TO = Deno.env.get("NOTIFY_EMAIL") ?? "markusmj2256@gmail.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Saltet må ikke kunne gættes, ellers kan et IP-hash slås tilbage til en adresse.
const IP_SALT = Deno.env.get("IP_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function corsHeaders(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const clean = (v: unknown, max = 2000) => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Kun POST" }, 405);
  if (!origin || !(ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin))) {
    return json({ error: "Ukendt oprindelse" }, 403);
  }
  if (Number(req.headers.get("content-length")) > 20000) return json({ error: "For stor forespørgsel" }, 413);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "ukendt";
  const ipHash = await hashIp(ip);
  // Flyer visits share this authenticated public endpoint, but never send mail
  // and never consume the contact form's rate-limit allowance.
  if (body.action === "flyer_visit") {
    const id = clean(body.visit_id, 36);
    const flyer = clean(body.flyer_id, 10);
    const path = clean(body.landing_path, 60);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        || !flyer || !/^f[1-5]$/.test(flyer)
        || !path || !["/", "/index.html", "/eneundervisning.html", "/holdundervisning.html"].includes(path)) {
      return json({ error: "Ugyldigt flyer-link" }, 400);
    }
    const agent = req.headers.get("user-agent") ?? "";
    if (/bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram/i.test(agent)) {
      return json({ ok: false, ignored: true });
    }
    const { data, error } = await supabase.rpc("register_tutor_flyer_visit", {
      p_id: id, p_flyer: flyer, p_path: path,
      p_ip_hash: await hashIp(`flyer:${new Date().toISOString().slice(0, 10)}:${ip}`),
      p_test: body.is_test === true || origin.startsWith("http://") || PREVIEW_ORIGIN.test(origin),
    });
    if (error) return json({ error: "Kunne ikke registrere besøget" }, 500);
    return json(data, data?.reason === "rate_limit" ? 429 : 200);
  }
  const log = (outcome: string) =>
    supabase.from("tutor_submit_log").insert({ ip_hash: ipHash, outcome });

  // 1. Honeypot. Vi svarer 200, så botten ikke lærer noget af afvisningen.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    await log("honeypot");
    return json({ ok: true });
  }

  // 2. Tidskontrol. Samme stille afvisning.
  const elapsed = Number(body.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) {
    await log("forhurtig");
    return json({ ok: true });
  }

  // 3. Rate limit pr. IP.
  const nowMs = Date.now();
  const countSince = async (ms: number) => {
    const { count } = await supabase
      .from("tutor_submit_log")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", new Date(nowMs - ms).toISOString());
    return count ?? 0;
  };
  const [lastHour, lastDay] = await Promise.all([
    countSince(3600_000),
    countSince(86_400_000),
  ]);
  if (lastHour >= MAX_PER_HOUR || lastDay >= MAX_PER_DAY) {
    await log("rate_limit");
    return json({
      error:
        "Vi har modtaget flere henvendelser fra dig nu. Ring endelig på 24 25 99 86, " +
        "hvis det haster — ellers vender Markus tilbage på den besked, du allerede har sendt.",
    }, 429);
  }

  // 4. Validering.
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 200);

  if (!name) {
    await log("ugyldig");
    return json({ error: "Navn mangler" }, 400);
  }
  if (!phone && !email) {
    await log("ugyldig");
    return json({ error: "Udfyld enten telefon eller mail, så Markus kan svare" }, 400);
  }
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    await log("ugyldig");
    return json({ error: "Mailadressen ser ikke rigtig ud" }, 400);
  }

  const lead = {
    source: clean(body.source, 40) ?? "ukendt",
    name,
    phone,
    email,
    level: clean(body.level, 120),
    subject: clean(body.subject, 200),
    package: clean(body.package, 120),
    message: clean(body.message, 4000),
    page_url: clean(body.page_url, 400),
    user_agent: clean(req.headers.get("user-agent"), 400),
    ip_hash: ipHash,
    flyer_id: clean(body.flyer_id, 10),
    flyer_visit_id: clean(body.flyer_visit_id, 36),
  };

  // 5. Gem. Databasefunktionen slår sammen med en eventuel tidligere
  //    henvendelse fra samme person på samme formular.
  const { data: saved, error: dbError } = await supabase
    .rpc("submit_tutor_lead_with_attribution", { payload: lead });

  if (dbError) {
    console.error("Kunne ikke gemme henvendelse:", dbError.message);
    await log("fejl");
    return json({ error: "Kunne ikke gemme henvendelsen" }, 500);
  }

  const isDuplicate = Boolean(saved?.duplicate);
  await log(isDuplicate ? "dublet" : "ok");

  // Beskeden er gemt. Mailen er en bekvemmelighed ovenpå — fejler den,
  // svarer vi stadig 200, og henvendelsen kan findes på admin-siden.
  let emailSent = false;
  if (RESEND_API_KEY) {
    const rows: [string, string | null][] = [
      ["Navn", lead.name],
      ["Telefon", lead.phone],
      ["Mail", lead.email],
      ["Klassetrin", lead.level],
      ["Fag", lead.subject],
      ["Pakke", lead.package],
      ["Formular", lead.source],
    ];
    const heading = isDuplicate
      ? `Gentagen henvendelse (${saved.submissions}. gang)`
      : "Ny henvendelse fra hjemmesiden";
    const html = `
      <h2 style="font-family:system-ui">${heading}</h2>
      <table style="font-family:system-ui;border-collapse:collapse">
        ${rows.filter(([, v]) => v).map(([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td>` +
          `<td style="padding:4px 0"><strong>${escapeHtml(v!)}</strong></td></tr>`).join("")}
      </table>
      ${lead.message ? `<p style="font-family:system-ui"><em>Besked:</em><br>${escapeHtml(lead.message).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="font-family:system-ui;color:#999;font-size:12px">Henvendelse ${saved.id}</p>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Lokaltutor <onboarding@resend.dev>",
          to: [NOTIFY_TO],
          reply_to: lead.email ?? undefined,
          subject: isDuplicate
            ? `Gentagen henvendelse fra ${lead.name}`
            : `Ny henvendelse fra ${lead.name}`,
          html,
        }),
      });
      if (res.ok) {
        emailSent = true;
        await supabase.from("tutor_leads")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", saved.id);
      } else {
        console.error("Resend afviste mailen:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Kunne ikke sende mail:", err);
    }
  } else {
    console.warn("RESEND_API_KEY mangler — henvendelsen er gemt, men der blev ikke sendt mail.");
  }

  // Ryd gammel rate limit-log af og til, så tabellen ikke vokser uendeligt.
  if (Math.random() < 0.02) {
    await supabase.from("tutor_flyer_visits")
      .update({ ip_day_hash: null })
      .not("ip_day_hash", "is", null)
      .lt("created_at", new Date(nowMs - 2 * 86_400_000).toISOString());
    await supabase.from("tutor_submit_log")
      .delete()
      .lt("created_at", new Date(nowMs - 30 * 86_400_000).toISOString());
  }

  return json({ ok: true, id: saved.id, duplicate: isDuplicate, emailSent });
});
