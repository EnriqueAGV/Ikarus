// Patients will write about emergencies to a doctor's WhatsApp whatever the
// product says. These messages never reach the LLM: a fixed reply points to
// 911 and Cruz Roja, and the conversation goes to the practice's team.
// False positives only cost a handoff, so the list leans broad.

export const EMERGENCY_REPLY =
  "Este número solo agenda citas. Si es una emergencia, llame al 911 o a Cruz Roja al 132. Ya le avisamos al equipo del consultorio.";

const PATTERNS = [
  /\bemergencia/,
  /\bdolor (fuerte )?(de|en el) pecho/,
  /\b(no puedo|no puede|no podemos|dificultad para|me cuesta|le cuesta) respirar/,
  /\b(me|le|nos) falta (el )?aire/,
  /\b(me|se) (ahogo|ahoga)\b/,
  /\bdesmay/,
  /\binconsciente/,
  /\bno reacciona/,
  /\bconvulsi/,
  /\binfarto/,
  /\bderrame cerebral/,
  /\bhemorragia/,
  /\bmucha sangre/,
  /\b(sangra|sangrando) mucho/,
  /\bno (para|deja) de sangrar/,
  /\bsuicid/,
  /\b(quitarme|quitarse) la vida/,
  /\bme quiero morir/,
  /\bmatarme\b/,
  /\bsobredosis/,
  /\benvenen/,
  /\bintoxicad/,
  /\baccidente/,
  /\b(cara|boca) (torcida|chueca|caida)/,
  /\bno (puedo|puede) mover (el brazo|la pierna|la mitad|un lado)/,
];

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

export function isEmergency(text: string | null | undefined) {
  if (!text) return false;
  const t = normalize(text);
  return PATTERNS.some((p) => p.test(t));
}
