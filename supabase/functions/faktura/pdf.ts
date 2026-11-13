// Tegner fakturaen som en A4-PDF med pdf-lib. Biblioteket gives med som
// argument, så filen kan køre både i edge-funktionen og i en node-test.

import { type Invoice, kr, longDate, num } from "./faktura.ts";

// deno-lint-ignore no-explicit-any
type Lib = any;

const W = 595.28;
const H = 841.89;
const M = 56;

export async function buildPdf(lib: Lib, inv: Invoice, opts: { draft?: boolean } = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    accent: hex("#1f4d3a"), ink: hex("#1b2420"), muted: hex("#59625b"), line: hex("#e2d9c6"),
    soft: hex("#e2eadb"), cream: hex("#faf5ea"), clay: hex("#a6483f"),
  };

  const doc = await PDFDocument.create();
  const credit = inv.kind === "kreditnota";
  const title = credit ? "Kreditnota" : "Faktura";
  doc.setTitle(`${title} ${inv.number ?? "(kladde)"}`);
  doc.setAuthor(inv.seller.seller_name || "Lokaltutor");
  const page = doc.addPage([W, H]);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifMark = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);

  // Standardfontene kan kun vestlige tegn. Alt andet erstattes, så et navn
  // med et uventet tegn ikke får hele fakturaen til at fejle.
  const known = new Set<number>(sans.getCharacterSet());
  const safe = (value: unknown) => Array.from(String(value ?? ""))
    .map((ch) => (known.has(ch.codePointAt(0)!) ? ch : ch === "‑" ? "-" : "?")).join("");

  // deno-lint-ignore no-explicit-any
  const text = (value: unknown, x: number, y: number, o: { font?: any; size?: number; color?: any; right?: boolean } = {}) => {
    const font = o.font ?? sans;
    const size = o.size ?? 10;
    const s = safe(value);
    page.drawText(s, { x: o.right ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color: o.color ?? C.ink });
  };
  // deno-lint-ignore no-explicit-any
  const wrap = (value: unknown, font: any, size: number, width: number) => {
    const out: string[] = [];
    let line = "";
    for (const word of safe(value).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const label = (value: string, x: number, y: number) => text(value.toUpperCase(), x, y, { font: bold, size: 7.5, color: C.muted });
  const rule = (y: number, color = C.line, thickness = 0.8) =>
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });

  // ---- Hoved ----
  let y = H - M;
  page.drawRectangle({ x: M, y: y - 36, width: 36, height: 36, color: C.accent });
  text("MJ", M + 18 - serifMark.widthOfTextAtSize("MJ", 17) / 2, y - 24, { font: serifMark, size: 17, color: C.cream });
  text("Lokaltutor", M + 48, y - 15, { font: serif, size: 17 });
  text("Matematik & naturfag · lokaltutor.dk", M + 48, y - 29, { size: 8.5, color: C.muted });
  text(title, W - M, y - 27, { font: serif, size: 32, color: C.accent, right: true });
  if (opts.draft) text("KLADDE – IKKE UDSTEDT", W - M, y - 44, { font: bold, size: 8, color: C.clay, right: true });

  // ---- Modtager og nøgledata ----
  y -= 92;
  label(credit ? "Krediteres" : "Faktureres til", M, y);
  let ly = y - 16;
  text(inv.recipient_name, M, ly, { font: bold, size: 11 });
  for (const part of inv.recipient_address.split(",").map((p) => p.trim()).filter(Boolean)) {
    for (const l of wrap(part, sans, 10, 250)) { ly -= 14; text(l, M, ly); }
  }
  ly -= 14; text(inv.recipient_email, M, ly, { color: C.muted });
  ly -= 14; text(`Elev: ${inv.student}`, M, ly, { color: C.muted });

  const meta: [string, string][] = [
    [credit ? "Kreditnota nr." : "Fakturanr.", inv.number == null ? "Kladde" : String(inv.number)],
    [credit ? "Dato" : "Fakturadato", longDate(inv.issued_on)],
  ];
  if (credit) meta.push(["Vedrører faktura", String(inv.credits_number ?? "")]);
  else meta.push(["Betales senest", longDate(inv.due_on)]);
  let ry = y;
  for (const [k, v] of meta) {
    label(k, 360, ry);
    text(v, W - M, ry - 1, { font: bold, size: 10, right: true });
    ry -= 20;
  }

  // ---- Linjer ----
  y = Math.min(ly, ry) - 34;
  const colQty = 392, colPrice = 468, colAmount = W - M;
  label("Beskrivelse", M, y);
  text("ANTAL", colQty, y, { font: bold, size: 7.5, color: C.muted, right: true });
  text("PRIS", colPrice, y, { font: bold, size: 7.5, color: C.muted, right: true });
  text("BELØB", colAmount, y, { font: bold, size: 7.5, color: C.muted, right: true });
  y -= 9; rule(y, C.ink, 1);
  for (const l of inv.lines) {
    y -= 20;
    const rows = wrap(l.text, sans, 10, colQty - M - 70);
    text(rows[0] ?? "", M, y);
    if (l.unit) text(`${num(l.qty)} ${l.unit}`, colQty, y, { right: true });
    if (l.unit) text(kr(l.unit_price), colPrice, y, { right: true });
    text(kr(l.amount), colAmount, y, { right: true });
    for (const extra of rows.slice(1)) { y -= 13; text(extra, M, y); }
    y -= 11; rule(y);
  }

  // ---- Sum ----
  y -= 24;
  if (inv.vat_rate > 0) {
    text(`Heraf moms (${num(inv.vat_rate)} %)`, colPrice, y, { color: C.muted, right: true });
    text(kr(inv.vat_amount), colAmount, y, { color: C.muted, right: true });
    y -= 22;
  }
  const totalWidth = serif.widthOfTextAtSize(safe(kr(inv.total)), 18);
  text(credit ? "Krediteres i alt" : "At betale", colAmount - totalWidth - 16, y, { font: bold, size: 11, right: true });
  text(kr(inv.total), colAmount, y - 1, { font: serif, size: 18, color: C.accent, right: true });
  if (inv.seller.vat_note) {
    y -= 22;
    for (const l of wrap(inv.seller.vat_note, sans, 8.5, W - 2 * M)) { text(l, M, y, { size: 8.5, color: C.muted }); y -= 11; }
  }

  // ---- Betaling ----
  y -= 30;
  const hasBank = !!(inv.seller.bank_reg && inv.seller.bank_account);
  const boxH = credit ? 52 : 96;
  page.drawRectangle({ x: M, y: y - boxH, width: W - 2 * M, height: boxH, color: C.soft });
  const bx = M + 18;
  if (credit) {
    text("Beløbet modregnes eller betales tilbage efter aftale.", bx, y - 22, { font: bold, size: 10.5 });
    text(`Denne kreditnota ophæver faktura ${inv.credits_number ?? ""}.`, bx, y - 38, { color: C.muted, size: 9.5 });
  } else {
    text(`Betal ${kr(inv.total)} senest ${longDate(inv.due_on)}`, bx, y - 24, { font: bold, size: 11.5, color: C.accent });
    let cx = bx;
    if (hasBank) {
      label("Bankoverførsel", cx, y - 46);
      text(`Reg. ${inv.seller.bank_reg}   Konto ${inv.seller.bank_account}`, cx, y - 61, { font: bold });
      cx += 230;
    }
    if (inv.seller.mobilepay) {
      label("MobilePay", cx, y - 46);
      text(inv.seller.mobilepay, cx, y - 61, { font: bold });
    }
    text(`Skriv fakturanr. ${inv.number ?? ""} i beskeden, så betalingen kan findes igen.`, bx, y - 81, { size: 9, color: C.muted });
  }

  // ---- Fod ----
  const s = inv.seller;
  const foot = [
    [s.seller_name, s.cvr && `CVR ${s.cvr}`].filter(Boolean).join(" · "),
    [s.address, s.zip_city, s.email, s.phone && `Tlf. ${s.phone}`].filter(Boolean).join(" · "),
  ];
  rule(M + 30);
  foot.forEach((row, i) => {
    const str = safe(row);
    text(str, (W - sans.widthOfTextAtSize(str, 8.5)) / 2, M + 16 - i * 12, { size: 8.5, color: C.muted });
  });

  return await doc.save();
}
