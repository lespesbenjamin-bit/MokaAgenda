/**
 * Emails transactionnels de réservation — gabarits purs (testables).
 * Chaque gabarit produit un objet, une version HTML et une version texte.
 * Toutes les valeurs saisies sont échappées.
 */
import { formatEuros } from "@/lib/domain/pricing";

export type NotificationKind =
  | "booking_confirmed_customer"
  | "booking_new_pro"
  | "booking_cancelled_customer"
  | "booking_cancelled_pro"
  | "booking_rescheduled_customer"
  | "booking_rescheduled_pro"
  | "reminder_customer";

export interface EmailBooking {
  businessName: string;
  businessPhone: string | null;
  businessEmail: string | null;
  timeZone: string;
  reference: string;
  startsAt: Date;
  durationMinutes: number;
  place: "home" | "salon";
  address: { line1: string | null; line2: string | null; postal_code: string | null; city: string | null } | null;
  serviceNames: string[];
  priceTotalCents: number;
  depositCents: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  comment: string | null;
  cancellationPolicy: string | null;
  cancellationNoticeHours: number | null;
  /** Date de début précédente (déplacement). */
  previousStartsAt?: Date | null;
  /** Qui a fait la modification (affiché à l'autre partie). */
  changedBy?: "customer" | "pro";
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailLinks {
  /** Lien secret de gestion (cliente). */
  manageUrl?: string | null;
  /** Lien vers le rendez-vous dans l'agenda (professionnelle). */
  agendaUrl?: string | null;
  /** Page publique de réservation (pour reprendre rendez-vous). */
  bookingUrl?: string | null;
}

const BRAND = "#cc4a0c";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatDateTime(date: Date, timeZone: string): string {
  const d = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  const t = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
  return `${d} à ${t.replace(":", " h ")}`.replace(/ h 00$/, " h");
}

function placeText(b: EmailBooking): string {
  if (b.place === "salon") return "En institut";
  const a = b.address;
  const line = a ? [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  return line ? `À domicile — ${line}` : "À domicile";
}

function rows(b: EmailBooking, { forPro }: { forPro: boolean }): [string, string][] {
  const out: [string, string][] = [
    ["Prestation", b.serviceNames.join(", ")],
    ["Date", formatDateTime(b.startsAt, b.timeZone)],
    ["Durée", `${b.durationMinutes} min`],
    ["Lieu", placeText(b)],
    ["Prix", formatEuros(b.priceTotalCents)],
  ];
  if (b.depositCents > 0) out.push(["Acompte", formatEuros(b.depositCents)]);
  if (forPro) {
    out.unshift(["Cliente", b.customerName]);
    if (b.customerPhone) out.push(["Téléphone", b.customerPhone]);
    if (b.customerEmail) out.push(["Email", b.customerEmail]);
    if (b.comment) out.push(["Commentaire", b.comment]);
  }
  out.push(["Référence", b.reference]);
  return out;
}

function layout(title: string, intro: string, table: [string, string][], extra: { html: string; text: string }, b: EmailBooking): RenderedEmail & { subject: string } {
  const htmlRows = table
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;color:#18181b">${escapeHtml(v)}</td></tr>`)
    .join("");
  const contact = [b.businessPhone, b.businessEmail].filter(Boolean).join(" · ");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:13px;font-weight:600;color:${BRAND}">${escapeHtml(b.businessName)}</td></tr>
<tr><td style="padding-top:8px;font-size:22px;font-weight:700;color:#18181b">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:8px;font-size:15px;line-height:1.5;color:#3f3f46">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-top:18px"><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.4">${htmlRows}</table></td></tr>
${extra.html}
${contact ? `<tr><td style="padding-top:22px;font-size:13px;color:#71717a">Contact : ${escapeHtml(contact)}</td></tr>` : ""}
<tr><td style="padding-top:22px;font-size:12px;color:#a1a1aa">Envoyé par Moka Réservation pour ${escapeHtml(b.businessName)}.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    b.businessName,
    "",
    title,
    intro,
    "",
    ...table.map(([k, v]) => `${k} : ${v}`),
    extra.text ? `\n${extra.text}` : "",
    contact ? `\nContact : ${contact}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();
  return { subject: "", html, text };
}

function button(label: string, url: string): { html: string; text: string } {
  return {
    html: `<tr><td style="padding-top:22px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:999px">${escapeHtml(label)}</a></td></tr>`,
    text: `${label} : ${url}`,
  };
}

function paragraph(text: string): { html: string; text: string } {
  return { html: `<tr><td style="padding-top:18px;font-size:13px;line-height:1.5;color:#52525b;white-space:pre-line">${escapeHtml(text)}</td></tr>`, text };
}

function join(...parts: ({ html: string; text: string } | null)[]): { html: string; text: string } {
  const p = parts.filter((x): x is { html: string; text: string } => x !== null);
  return { html: p.map((x) => x.html).join(""), text: p.map((x) => x.text).join("\n\n") };
}

function policyBlock(b: EmailBooking): { html: string; text: string } | null {
  const lines: string[] = [];
  if (b.cancellationNoticeHours != null) {
    lines.push(
      b.cancellationNoticeHours > 0
        ? `Annulation ou modification en ligne possible jusqu'à ${b.cancellationNoticeHours} h avant le rendez-vous.`
        : "Annulation ou modification en ligne possible jusqu'au début du rendez-vous.",
    );
  }
  if (b.cancellationPolicy) lines.push(b.cancellationPolicy);
  return lines.length ? paragraph(lines.join("\n")) : null;
}

export function renderEmail(kind: NotificationKind, b: EmailBooking, links: EmailLinks = {}): RenderedEmail {
  const when = formatDateTime(b.startsAt, b.timeZone);
  const manage = links.manageUrl ? button("Gérer mon rendez-vous", links.manageUrl) : null;
  const agenda = links.agendaUrl ? button("Voir dans l'agenda", links.agendaUrl) : null;
  const rebook = links.bookingUrl ? button("Reprendre rendez-vous", links.bookingUrl) : null;
  const previous = b.previousStartsAt ? `Ancien créneau : ${formatDateTime(b.previousStartsAt, b.timeZone)}.` : "";

  switch (kind) {
    case "booking_confirmed_customer": {
      const r = layout("Votre rendez-vous est confirmé", `Merci ${b.customerName}, votre réservation est enregistrée pour le ${when}.`, rows(b, { forPro: false }), join(manage, policyBlock(b)), b);
      return { ...r, subject: `Rendez-vous confirmé — ${b.businessName}` };
    }
    case "booking_new_pro": {
      const r = layout("Nouvelle réservation en ligne", `${b.customerName} a réservé pour le ${when}. Le rendez-vous est déjà dans votre agenda.`, rows(b, { forPro: true }), join(agenda), b);
      return { ...r, subject: `Nouvelle réservation : ${b.customerName}, ${when}` };
    }
    case "booking_cancelled_customer": {
      const intro = b.changedBy === "pro" ? `${b.businessName} a annulé votre rendez-vous du ${when}.` : `Votre rendez-vous du ${when} est bien annulé.`;
      const r = layout("Rendez-vous annulé", intro, rows(b, { forPro: false }), join(rebook), b);
      return { ...r, subject: `Rendez-vous annulé — ${b.businessName}` };
    }
    case "booking_cancelled_pro": {
      const r = layout("Rendez-vous annulé par la cliente", `${b.customerName} a annulé son rendez-vous du ${when}. Le créneau est de nouveau libre.`, rows(b, { forPro: true }), join(agenda), b);
      return { ...r, subject: `Annulation : ${b.customerName}, ${when}` };
    }
    case "booking_rescheduled_customer": {
      const intro = b.changedBy === "pro" ? `${b.businessName} a déplacé votre rendez-vous au ${when}. ${previous}` : `Votre rendez-vous est déplacé au ${when}. ${previous}`;
      const r = layout("Rendez-vous modifié", intro.trim(), rows(b, { forPro: false }), join(manage, policyBlock(b)), b);
      return { ...r, subject: `Rendez-vous modifié — ${b.businessName}` };
    }
    case "booking_rescheduled_pro": {
      const r = layout("Rendez-vous déplacé par la cliente", `${b.customerName} a déplacé son rendez-vous au ${when}. ${previous}`.trim(), rows(b, { forPro: true }), join(agenda), b);
      return { ...r, subject: `Modification : ${b.customerName}, ${when}` };
    }
    case "reminder_customer": {
      const r = layout("Rappel de votre rendez-vous", `Nous vous rappelons votre rendez-vous du ${when}.`, rows(b, { forPro: false }), join(manage, policyBlock(b)), b);
      return { ...r, subject: `Rappel : rendez-vous ${when}` };
    }
  }
}
