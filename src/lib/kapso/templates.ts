// WhatsApp templates Ikarus creates on every business's WABA once its number
// connects. Reminders go out after the 24h customer-service window closes,
// so they must be pre-approved UTILITY templates.

export const TEMPLATE_LANGUAGE = "es";

const example = {
  nombre: "Ana",
  servicio: "Corte de cabello",
  negocio: "Estética Luna",
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
    name: "ikarus_recordatorio",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, te recordamos tu cita de {{servicio}} en {{negocio}} el {{fecha}} a las {{hora}}. ¿Nos confirmas tu asistencia?",
        ["nombre", "servicio", "negocio", "fecha", "hora"],
      ),
      appointmentButtons,
    ],
  },
  {
    name: "ikarus_seguimiento",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, aún no recibimos tu confirmación para tu cita de {{servicio}} el {{fecha}} a las {{hora}}. Si no la confirmas en las próximas 2 horas, la cita se cancelará.",
        ["nombre", "servicio", "fecha", "hora"],
      ),
      appointmentButtons,
    ],
  },
  {
    name: "ikarus_cita_cancelada",
    language: TEMPLATE_LANGUAGE,
    category: "UTILITY",
    parameter_format: "NAMED",
    components: [
      body(
        "Hola {{nombre}}, cancelamos tu cita de {{servicio}} del {{fecha}} a las {{hora}} porque no recibimos tu confirmación. Escríbenos cuando quieras agendar de nuevo.",
        ["nombre", "servicio", "fecha", "hora"],
      ),
      {
        type: "BUTTONS",
        buttons: [{ type: "QUICK_REPLY", text: "Agendar de nuevo" }],
      },
    ],
  },
] as const;

export type TemplateName = (typeof TEMPLATES)[number]["name"];
