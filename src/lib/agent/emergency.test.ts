import { describe, expect, it } from "vitest";
import { isEmergency } from "./emergency";

describe("isEmergency", () => {
  it("catches emergencies however they are written", () => {
    for (const text of [
      "Tengo DOLOR DE PECHO desde la mañana",
      "mi mamá no puede respirar",
      "se desmayó mi hijo",
      "Es una emergencia!!",
      "esta sangrando mucho",
      "me quiero morir",
      "tiene la cara torcida",
    ]) {
      expect(isEmergency(text), text).toBe(true);
    }
  });

  it("leaves ordinary booking messages alone", () => {
    for (const text of ["Quiero una cita para el martes", "Es para control de presión", "¿Tienen espacio urgente mañana?", null]) {
      expect(isEmergency(text), String(text)).toBe(false);
    }
  });
});
