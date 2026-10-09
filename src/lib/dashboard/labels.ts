import { es } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";

export const appointmentStatusLabel = {
  booked: "Agendada",
  reminder_sent: "Recordatorio enviado",
  followup_sent: "Seguimiento enviado",
  confirmed: "Confirmada",
  cancelled_by_client: "Cancelada por el paciente",
  cancelled_by_business: "Cancelada por el consultorio",
  auto_cancelled: "Cancelada sin respuesta",
  completed: "Atendida",
  no_show: "No asistió",
} as const;

type Labeled = { status: keyof typeof appointmentStatusLabel; escalatedAt: Date | null };
const awaitingReply = new Set(["reminder_sent", "followup_sent"]);

// An unanswered appointment the team should call about reads as such.
export function appointmentLabel(a: Labeled) {
  return a.escalatedAt && awaitingReply.has(a.status) ? "Sin confirmar, llamar" : appointmentStatusLabel[a.status];
}

export function appointmentTone(a: Labeled) {
  return a.escalatedAt && awaitingReply.has(a.status)
    ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
    : appointmentStatusTone[a.status];
}

export const appointmentStatusTone: Record<keyof typeof appointmentStatusLabel, string> = {
  booked: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  reminder_sent: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  followup_sent: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  confirmed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled_by_client: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-900",
  cancelled_by_business: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-900",
  auto_cancelled: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-900",
  completed: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  no_show: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export const weekdayLabel = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export const settingsErrorLabel: Record<string, string> = {
  invalid_time: "Revisa las horas: usa el formato HH:MM.",
  end_before_start: "La hora de cierre debe ser después de la de apertura.",
  overlap: "Hay horarios que se enciman el mismo día.",
  invalid_weekday: "Día no válido.",
  invalid_date: "Fecha no válida.",
  name_required: "El servicio necesita un nombre.",
  doctor_name_required: "El doctor necesita un nombre.",
  unknown_practitioner: "Ese doctor no existe en este consultorio.",
  invalid_duration: "La duración debe estar entre 5 y 720 minutos.",
  invalid_buffer: "El margen debe estar entre 0 y 240 minutos.",
  label_required: "La pregunta necesita un texto.",
  choice_needs_options: "Una pregunta de opciones necesita al menos dos opciones.",
  invalid_reminder_hours: "El recordatorio debe enviarse entre 1 y 168 horas antes.",
  instructions_too_long: "Las instrucciones son demasiado largas (máximo 4000 caracteres).",
  invalid_email: "Correo no válido.",
  invalid_dui: "El DUI debe tener 9 dígitos (00000000-0).",
  invalid_birth_date: "La fecha de nacimiento no es válida.",
  forbidden: "No tienes permiso para hacer eso.",
  not_found: "No se encontró.",
  last_manager: "El consultorio debe tener al menos una persona que lo administre.",
  invite_failed: "No se pudo invitar a esa persona.",
  window_closed: "Solo puedes escribir en las 24 horas siguientes al último mensaje del paciente.",
  not_connected: "El WhatsApp del consultorio no está conectado.",
  send_failed: "No se pudo enviar el mensaje.",
  empty: "Escribe un mensaje.",
};

export function formatLocal(instant: Date, timezone: string, pattern = "EEE d MMM, HH:mm") {
  return formatInTimeZone(instant, timezone, pattern, { locale: es });
}

export function formatPhone(waPhone: string) {
  return `+${waPhone}`;
}
