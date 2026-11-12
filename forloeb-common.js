/* Fælles for kundesiden (forloeb.js) og dens backend (forloeb-admin.js).
 *
 * Adgangen styres af row level security i databasen, ikke af denne fil.
 * Anon-nøglen herunder er offentlig; hvad en indlogget bruger må læse,
 * afgør politikkerne i supabase/migrations/…_kundeforloeb.sql. */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const SUPABASE_URL = "https://kslmcjkyhxdevdfyzzrb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbG1jamt5aHhkZXZkZnl6enJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Mzc4NDIsImV4cCI6MjEwMTAxMzg0Mn0.lP-uPzYevRcKCos3wOQVB56XjrDgWrHqXJtSt1x-300";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const FORLOEB_SELECT =
  "*, forloeb_parents(*), forloeb_packages(*), forloeb_sessions(*)";

/* Databasens rækker oversat til den form, siderne tegner ud fra. */
export function toCustomer(row) {
  return {
    id: row.id,
    student: row.student,
    grade: row.grade,
    subject: row.subject,
    goal: row.goal,
    next: { date: row.next_date || "", time: (row.next_time || "").slice(0, 5) },
    parents: (row.forloeb_parents || []).map((p) => ({
      id: p.id, name: p.name, email: p.email,
      invited: p.invited_at, lastLogin: p.last_login_at,
    })).sort((a, b) => a.name.localeCompare(b.name, "da")),
    packages: (row.forloeb_packages || []).map((p) => ({
      id: p.id, date: p.bought_on, hours: Number(p.hours),
    })).sort((a, b) => a.date.localeCompare(b.date)),
    sessions: (row.forloeb_sessions || []).map((s) => ({
      id: s.id, date: s.held_on, hours: Number(s.hours), level: s.level,
      topic: s.topic, worked: s.worked, good: s.good, next: s.next_step,
    })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ---------- Beregninger ---------- */

const pad = (n) => String(n).padStart(2, "0");
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function stats(c) {
  const bought = c.packages.reduce((sum, p) => sum + p.hours, 0);
  const used = c.sessions.reduce((sum, s) => sum + s.hours, 0);
  const left = Math.max(0, bought - used);
  const typical = c.sessions.length ? used / c.sessions.length : 1.5;
  return { bought, used, left, typical, sessionsLeft: Math.round(left / typical) };
}

/* Hvad kræver ejerens opmærksomhed på dette forløb? */
export function flags(c) {
  const out = [];
  const st = stats(c);
  const nextPassed = c.next.date && c.next.date < today();
  if (nextPassed && !c.sessions.some((s) => s.date === c.next.date)) {
    out.push({ kind: "report", text: `Rapport mangler for ${fmtDate(c.next.date)}` });
  }
  if (st.used > st.bought) out.push({ kind: "hours", text: `${fmtHours(st.used - st.bought)} over pakken` });
  else if (st.left <= 3) out.push({ kind: "hours", text: `${fmtHours(st.left)} tilbage` });
  if (!c.next.date || nextPassed) out.push({ kind: "plan", text: "Næste gang er ikke aftalt" });
  if (!c.parents.length) out.push({ kind: "login", text: "Ingen forældre har adgang" });
  c.parents.filter((p) => !p.lastLogin).forEach((p) => {
    out.push({ kind: "login", text: `${firstName(p.name)} har ikke logget ind` });
  });
  return out;
}

/* ---------- Formatering ---------- */

const parse = (value) => new Date(String(value).length <= 10 ? `${value}T12:00:00` : value);
const longFmt = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" });
export const fmtDate = (value) => (value ? shortFmt.format(parse(value)).replace(".", "") : "");
export const fmtDateLong = (value) => (value ? longFmt.format(parse(value)) : "");
export const fmtNum = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
export const fmtHours = (n) => `${fmtNum(n)} ${Number(n) === 1 ? "time" : "timer"}`;
export const fmtTime = (value) => (value ? `kl. ${String(value).slice(0, 5).replace(":", ".")}` : "");
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0];
export function possessive(name) {
  const f = firstName(name);
  return /[sxz]$/i.test(f) ? `${f}'` : `${f}s`;
}

/* Alt, der kommer fra databasen, går gennem esc(), før det sættes ind som HTML. */
export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
