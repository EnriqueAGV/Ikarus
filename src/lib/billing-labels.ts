import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import type { Standing } from "./billing";

const fmt = (d: Date | string, tz: string) =>
  formatInTimeZone(typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d, typeof d === "string" ? "UTC" : tz, "d 'de' MMMM yyyy", { locale: es });

// The clinic's billing state in a sentence, for its settings and Praxia's admin.
export function standingLabel(s: Standing, timezone: string) {
  switch (s.status) {
    case "unbilled":
      return "Sin plan de cobro";
    case "trial":
      return `Prueba gratis hasta el ${fmt(s.until, timezone)}`;
    case "active":
      // paid_until is the first unpaid day.
      return `Pagado hasta el ${fmt(addDays(new Date(`${s.until}T12:00:00Z`), -1).toISOString().slice(0, 10), timezone)}`;
    case "grace":
      return `Pago pendiente: el asistente se detiene el ${fmt(s.stopsOn, timezone)}`;
    case "expired":
      return `Vencido desde el ${fmt(s.since, timezone)}: el asistente y los recordatorios están detenidos`;
    case "suspended":
      return "Servicio suspendido: el asistente y los recordatorios están detenidos";
  }
}

// A banner for the clinic's dashboard when something needs doing: a trial
// about to end, a payment due, or the assistant stopped. Null otherwise.
export function standingNotice(s: Standing, timezone: string, now = new Date()) {
  if (s.status === "trial" && s.until.getTime() - now.getTime() < 7 * 86_400_000) {
    return { tone: "warn" as const, text: `Su prueba gratis termina el ${fmt(s.until, timezone)}. Vea cómo pagar en Ajustes, Plan y pagos.` };
  }
  if (s.status === "grace") {
    return { tone: "warn" as const, text: `Tiene un pago pendiente. El asistente se detiene el ${fmt(s.stopsOn, timezone)} si no se registra. Vea cómo pagar en Ajustes, Plan y pagos.` };
  }
  if (s.status === "expired" || s.status === "suspended") {
    return { tone: "stop" as const, text: "El asistente de WhatsApp y los recordatorios están detenidos por falta de pago. El panel sigue funcionando. Vea cómo pagar en Ajustes, Plan y pagos." };
  }
  return null;
}
