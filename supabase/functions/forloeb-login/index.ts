// Sender login-links til forældre på kundesiden (/forloeb).
//
// To måder at kalde den på:
//   { email }                         — en forælder beder om et link på /forloeb.
//   { action: "invite", parent_id }   — ejeren sender en invitation fra /forloeb-admin.
//                                       Kræver en indlogget admin.
//
// Linket indeholder et engangstoken fra Supabase Auth. Siden bytter det til en
// session, når forælderen trykker "Åbn forløbet" — ikke ved selve sidevisningen,
// så mailprogrammers linkscannere ikke bruger tokenet op.
//
// Svaret på en loginforespørgsel er det samme, uanset om mailen findes, så
// ingen kan bruge formularen til at finde ud af, hvem der er kunde.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const ALLOWED_ORIGINS = [
  "https://lokaltutor.dk",
  "https://www.lokaltutor.dk",
  "http://127.0.0.1:8099",
  "http://localhost:8099",
];
const PRODUCTION = "https://lokaltutor.dk";

const MAX_PER_IP_HOUR = 10;
const MAX_PER_EMAIL_HOUR = 5;
const MIN_SECONDS_BETWEEN = 60;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("FORLOEB_FROM") ?? "Markus Johnsen <login@lokaltutor.dk>";
const REPLY_TO = Deno.env.get("NOTIFY_EMAIL") ?? "markusmj2256@gmail.com";
const SALT = Deno.env.get("IP_SALT") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${SALT}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const possessive = (name: string) => {
  const f = firstName(name);
  return /[sxz]$/i.test(f) ? `${f}'` : `${f}s`;
};
function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
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
  if (Number(req.headers.get("content-length")) > 2000) return json({ error: "For stor forespørgsel" }, 413);

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

  const invite = body.action === "invite";
  let email: string;

  if (invite) {
    // Kun en indlogget admin må sende invitationer.
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(token);
    const callerEmail = userData?.user?.email_confirmed_at ? userData.user.email?.toLowerCase() : null;
    if (!callerEmail) return json({ error: "Log ind igen" }, 401);
    const { data: admins } = await supabase.from("admin_emails").select("email");
    const isAdmin = (admins ?? []).some((row: { email: string }) => row.email.toLowerCase() === callerEmail);
    if (!isAdmin) return json({ error: "Ingen adgang" }, 403);

    if (typeof body.parent_id !== "string" || !UUID.test(body.parent_id)) return json({ error: "Mangler forælder" }, 400);
    const { data: parent } = await supabase.from("forloeb_parents").select("email").eq("id", body.parent_id).maybeSingle();
    if (!parent) return json({ error: "Forælderen findes ikke" }, 404);
    email = parent.email;
  } else {
    if (typeof body.email !== "string") return json({ error: "Mangler mail" }, 400);
    email = body.email.trim().toLowerCase().slice(0, 200);
    if (!EMAIL.test(email)) return json({ error: "Ugyldig mail" }, 400);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "ukendt";
    const ipHash = await hash(`ip:${ip}`);
    const emailHash = await hash(`mail:${email}`);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();

    const { count: ipCount } = await supabase.from("forloeb_login_log")
      .select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo);
    if ((ipCount ?? 0) >= MAX_PER_IP_HOUR) return json({ error: "For mange forsøg. Prøv igen om en time." }, 429);

    const { data: recent } = await supabase.from("forloeb_login_log")
      .select("created_at").eq("email_hash", emailHash).eq("sent", true).gte("created_at", hourAgo)
      .order("created_at", { ascending: false });
    const tooSoon = recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < MIN_SECONDS_BETWEEN * 1000;
    const tooMany = (recent?.length ?? 0) >= MAX_PER_EMAIL_HOUR;

    const { data: rows } = await supabase.from("forloeb_parents").select("id").eq("email", email).limit(1);
    const known = (rows?.length ?? 0) > 0;
    const willSend = known && !tooSoon && !tooMany;
    await supabase.from("forloeb_login_log").insert({ ip_hash: ipHash, email_hash: emailHash, sent: willSend });

    if (Math.random() < 0.05) {
      await supabase.from("forloeb_login_log").delete()
        .lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
    }
    // Samme svar, uanset om mailen findes eller er bremset.
    if (!willSend) return json({ ok: true });
  }

  const { data: links } = await supabase.from("forloeb_parents")
    .select("id, name, forloeb ( student )").eq("email", email);
  if (!links?.length) return json({ ok: true });
  const parentName = firstName(links[0].name);
  // deno-lint-ignore no-explicit-any
  const students = links.map((row: any) => row.forloeb?.student).filter(Boolean) as string[];
  const whose = listNames(students.map(possessive));

  // Kontoen oprettes her, så ingen andre kan nå at oprette den med samme mail.
  const created = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    console.error("Kunne ikke oprette bruger:", created.error.message);
    return json(invite ? { error: "Kunne ikke oprette login" } : { ok: true }, invite ? 500 : 200);
  }

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("Kunne ikke lave login-link:", linkError?.message);
    return json(invite ? { error: "Kunne ikke lave login-link" } : { ok: true }, invite ? 500 : 200);
  }

  // Lokalt serveres siden med .html; i produktion uden.
  const base = origin!.startsWith("http://") ? `${origin}/forloeb.html` : `${PRODUCTION}/forloeb`;
  const url = `${base}#login=${encodeURIComponent(tokenHash)}`;

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY mangler — der blev ikke sendt noget login-link.");
    return json(invite ? { error: "Mailnøglen mangler i Supabase" } : { ok: true }, invite ? 500 : 200);
  }

  const subject = invite ? `Følg ${whose} forløb hos Markus` : `Dit login til ${whose} forløb`;
  const intro = invite
    ? `Jeg har oprettet en side, hvor du kan følge ${escapeHtml(whose)} undervisning: hvor mange timer der er tilbage, og en kort rapport efter hver gang.`
    : `Her er dit link til at se, hvordan det går med ${escapeHtml(whose)} undervisning.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.6;color:#3c382f;max-width:520px">
      <p>Hej ${escapeHtml(parentName)}</p>
      <p>${intro}</p>
      <p style="margin:26px 0">
        <a href="${url}" style="background:#e0a03c;color:#2a1d04;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;display:inline-block">Åbn forløbet</a>
      </p>
      <p style="color:#6f685c;font-size:14px">Linket virker i en time og kun én gang. Du kan altid få et nyt på
        <a href="${PRODUCTION}/forloeb" style="color:#9d5c0c">lokaltutor.dk/forloeb</a> ved at skrive denne mailadresse.</p>
      <p style="color:#6f685c;font-size:14px">Har du ikke bedt om mailen, kan du se bort fra den.</p>
      <p>Venlig hilsen<br>Markus Johnsen</p>
    </div>`;
  const text = `Hej ${parentName}\n\n${invite
    ? `Jeg har oprettet en side, hvor du kan følge ${whose} undervisning.`
    : `Her er dit link til at se, hvordan det går med ${whose} undervisning.`}\n\nÅbn forløbet: ${url}\n\nLinket virker i en time og kun én gang. Du kan altid få et nyt på ${PRODUCTION}/forloeb.\n\nVenlig hilsen\nMarkus Johnsen`;

  let sent = false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], reply_to: REPLY_TO, subject, html, text }),
    });
    sent = res.ok;
    if (!res.ok) console.error("Resend afviste mailen:", res.status, await res.text());
  } catch (err) {
    console.error("Kunne ikke sende mail:", err);
  }

  if (sent) {
    await supabase.from("forloeb_parents").update({ invited_at: new Date().toISOString() })
      .eq("email", email).is("invited_at", null);
  }
  if (invite) return sent ? json({ ok: true }) : json({ error: "Mailen kunne ikke sendes" }, 502);
  return json({ ok: true });
});
