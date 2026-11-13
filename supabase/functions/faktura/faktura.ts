// Regler og beregninger for fakturaer. Ingen netværk og ingen Deno-kald her,
// så filen kan testes direkte med node (tests/faktura.test.cjs).

export type Settings = {
  seller_name: string; cvr: string; address: string; zip_city: string; email: string; phone: string;
  bank_reg: string; bank_account: string; mobilepay: string;
  payment_days: number; vat_rate: number; vat_note: string;
};
export type Line = { text: string; qty: number; unit: string; unit_price: number; amount: number };
export type Invoice = {
  number: number | null; kind: "faktura" | "kreditnota"; credits_number?: number | null;
  issued_on: string; due_on: string; student: string;
  recipient_name: string; recipient_email: string; recipient_address: string;
  lines: Line[]; total: number; vat_rate: number; vat_amount: number;
  seller: Partial<Settings>;
};

// Priserne står også på lokaltutor.dk og i faktura-admin.js. Ret alle tre steder.
export const PACKAGES: Record<string, { label: string; unit_price: number }> = {
  p20: { label: "timepakke på 20 timer", unit_price: 350 },
  p40: { label: "timepakke på 40 timer eller mere", unit_price: 325 },
  enkelt: { label: "enkelttimer", unit_price: 400 },
};

const SELLER_FIELDS = [
  "seller_name", "cvr", "address", "zip_city", "email", "phone",
  "bank_reg", "bank_account", "mobilepay", "vat_note",
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function kr(n: number): string {
  const [whole, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec} kr.`;
}
export function num(n: number): string {
  return String(round2(n)).replace(".", ",");
}

const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${MONTHS[m - 1]} ${y}`;
}
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Dags dato i Danmark, uanset hvor serveren står. */
export function todayDK(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
}

/** Det, der skal være udfyldt, før en faktura må udstedes. Tom liste = klar. */
export function missingSettings(s: Partial<Settings> | null): string[] {
  const out: string[] = [];
  if (!s?.seller_name) out.push("virksomhedsnavn");
  if (!s?.cvr) out.push("CVR-nummer");
  if (!s?.address || !s?.zip_city) out.push("adresse");
  if (!((s?.bank_reg && s?.bank_account) || s?.mobilepay)) out.push("kontonummer eller MobilePay-nummer");
  return out;
}

export type Input = {
  package?: unknown; hours?: unknown; extra_text?: unknown; extra_amount?: unknown; recipient_address?: unknown;
};
export type Context = {
  forloeb: { id: string; student: string; subject: string };
  parent: { name: string; email: string };
  settings: Settings;
  today: string;
};

/** Fra formularens felter til den række, der gemmes. Returnerer { error } ved ugyldige tal. */
export function buildInvoice(input: Input, ctx: Context): { error: string } | { row: Record<string, unknown> & Invoice } {
  const pkg = PACKAGES[String(input.package)];
  if (!pkg) return { error: "Vælg en pakke" };
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours < 0.5 || hours > 500 || (hours * 2) % 1 !== 0) {
    return { error: "Antal timer skal være mellem 0,5 og 500 i halve timer" };
  }

  const subject = clean(ctx.forloeb.subject, 80);
  const lines: Line[] = [{
    text: `1:1-undervisning${subject ? ` i ${subject}` : ""} for ${ctx.forloeb.student} (${pkg.label})`,
    qty: hours, unit: hours === 1 ? "time" : "timer",
    unit_price: pkg.unit_price, amount: round2(hours * pkg.unit_price),
  }];

  const extraText = clean(input.extra_text, 80);
  const extraRaw = input.extra_amount === "" || input.extra_amount == null ? 0 : Number(input.extra_amount);
  if (!Number.isFinite(extraRaw) || Math.abs(extraRaw) > 100000) return { error: "Tillægget er ikke et gyldigt beløb" };
  const extra = round2(extraRaw);
  if (extra !== 0) {
    if (!extraText) return { error: "Skriv en tekst til tillægget" };
    lines.push({ text: extraText, qty: 1, unit: "", unit_price: extra, amount: extra });
  }

  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  if (total <= 0) return { error: "Fakturaens beløb skal være over 0 kr." };

  const vatRate = Number(ctx.settings.vat_rate) === 25 ? 25 : 0;
  const seller: Partial<Settings> = {};
  for (const key of SELLER_FIELDS) seller[key] = clean(ctx.settings[key], 200);

  return {
    row: {
      number: null, kind: "faktura",
      forloeb_id: ctx.forloeb.id, issued_on: ctx.today,
      due_on: addDays(ctx.today, Math.min(90, Math.max(0, Number(ctx.settings.payment_days) || 0))),
      student: ctx.forloeb.student,
      recipient_name: ctx.parent.name, recipient_email: ctx.parent.email,
      recipient_address: clean(input.recipient_address, 200),
      package: String(input.package), hours,
      lines, total,
      // Priserne er forbrugerpriser: er der moms på, er den indeholdt i beløbet.
      vat_rate: vatRate, vat_amount: vatRate ? round2(total * vatRate / (100 + vatRate)) : 0,
      seller,
    },
  };
}

/** En kreditnota, der ophæver hele den oprindelige faktura. */
export function buildCredit(original: Record<string, unknown> & Invoice & { id: string }, today: string) {
  return {
    number: null, kind: "kreditnota" as const, credits: original.id, credits_number: original.number,
    forloeb_id: original.forloeb_id ?? null, issued_on: today, due_on: today,
    student: original.student,
    recipient_name: original.recipient_name, recipient_email: original.recipient_email,
    recipient_address: original.recipient_address,
    package: original.package, hours: -Number(original.hours),
    lines: original.lines.map((l) => ({
      ...l, text: `Kreditering af faktura ${original.number}: ${l.text}`,
      qty: -l.qty, amount: -l.amount,
    })),
    total: -Number(original.total),
    vat_rate: Number(original.vat_rate), vat_amount: -Number(original.vat_amount),
    seller: original.seller,
  };
}

export const fileName = (inv: Pick<Invoice, "kind" | "number">) =>
  `${inv.kind === "kreditnota" ? "Kreditnota" : "Faktura"}-${inv.number ?? "kladde"}-Lokaltutor.pdf`;
