// WhatsApp templates Praxia creates on every clinic's WABA once its number
// connects. Reminders go out after the 24h customer-service window closes,
// so they must be pre-approved UTILITY templates. They carry the clinic, the
// doctor and the time only, never the service or reason for the visit:
// a lock screen notification should not reveal why someone sees a doctor.

export const TEMPLATE_LANGUAGE = "es";

const example = {
  nombre: "Ana",
  consultorio: "Consultorio Médico San Benito",
  doctor: "Dra. Ana López",
  fecha: "viernes 10 de octubre",
  hora: "10:30",
};

type Param = keyof typeof example;

function body(text: string, params: Param[]) {
  return {
    type: "BODY" as const,
    text,
    example: {
      body_text_named_params: params.map((p) => ({
        param_name: p,
        example: example[p],
      })),
    },
  };
}

const appointmentButtons = {
  type: "BUTTONS",
  buttons: [
    { type: "QUICK_REPLY", text: "Confirmar" },
    { type: "QUICK_REPLY", text: "Reprogramar" },
    { type: "QUICK_REPLY", text: "Cancelar" },
  ],
};

export const TEMPLATES = [
  {
    name: "praxia_recordatorio",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, le recordamos su cita en {{consultorio}} con {{doctor}} el {{fecha}} a las {{hora}}. ¿Nos confirma su asistencia?",
        ["nombre", "consultorio", "doctor", "fecha", "hora"],
      ),
      appointmentButtons,
    ],
  },
  // Follow-up for clinics that escalate: no cancellation warning.
  {
    name: "praxia_seguimiento",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, aún no recibimos su confirmación para su cita en {{consultorio}} con {{doctor}} el {{fecha}} a las {{hora}}. ¿Nos confirma su asistencia?",
        ["nombre", "consultorio", "doctor", "fecha", "hora"],
      ),
      appointmentButtons,
    ],
  },
  // Follow-up for clinics that auto-cancel: warns before cancelling.
  {
    name: "praxia_seguimiento_aviso",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, aún no recibimos su confirmación para su cita en {{consultorio}} con {{doctor}} el {{fecha}} a las {{hora}}. Si no la confirma en las próximas 2 horas, la cita se cancelará.",
        ["nombre", "consultorio", "doctor", "fecha", "hora"],
      ),
      appointmentButtons,
    ],
  },
  {
    name: "praxia_cita_cancelada",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, cancelamos su cita en {{consultorio}} del {{fecha}} a las {{hora}} porque no recibimos su confirmación. Escríbanos cuando quiera agendar de nuevo.",
        ["nombre", "consultorio", "fecha", "hora"],
      ),
      {
        type: "BUTTONS",
        buttons: [{ type: "QUICK_REPLY", text: "Agendar de nuevo" }],
      },
    ],
  },
] as const;

export type TemplateName = (typeof TEMPLATES)[number]["name"];
