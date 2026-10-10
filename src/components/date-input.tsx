"use client";
import { useEffect, useRef } from "react";
import { displayDate, isoDate } from "@/lib/dates";

/** Explicit presentation with an ISO value for existing server actions. */
export function DateInput({ name, defaultValue = "", min, max, required, className }: {
  name: string; defaultValue?: string; min?: string; max?: string; required?: boolean; className?: string;
}) {
  const hidden = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = visible.current?.form;
    const reset = () => {
      visible.current?.setCustomValidity("");
      // Hidden inputs update defaultValue when value changes; explicitly
      // restore the ISO value together with the visible field on form reset.
      if (hidden.current) hidden.current.value = defaultValue;
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  return <>
    <input ref={visible} type="text" data-field={name} defaultValue={displayDate(defaultValue)} placeholder="DD-MM-YYYY"
      pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}" maxLength={10} required={required} className={className}
      title="Fecha en formato DD-MM-YYYY" onChange={event => {
        const raw = event.currentTarget.value;
        const iso = isoDate(raw);
        const error = raw && (!iso || (min && iso < min) || (max && iso > max));
        event.currentTarget.setCustomValidity(error ? `Escribe una fecha válida en formato DD-MM-YYYY${min ? `, desde ${displayDate(min)}` : ""}${max ? `, hasta ${displayDate(max)}` : ""}.` : "");
        if (hidden.current) hidden.current.value = iso ?? "";
      }} />
    <input ref={hidden} type="hidden" name={name} defaultValue={defaultValue} />
  </>;
}
