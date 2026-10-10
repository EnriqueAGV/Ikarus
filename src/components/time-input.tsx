"use client";
import { useEffect, useRef } from "react";
import { displayTime, parseDisplayTime } from "@/lib/dates";

export function TimeInput({ name, defaultValue = "", required, className, ariaLabel }: {
  name: string; defaultValue?: string; required?: boolean; className?: string; ariaLabel?: string;
}) {
  const hidden = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = visible.current?.form;
    const reset = () => {
      visible.current?.setCustomValidity("");
      if (hidden.current) hidden.current.value = defaultValue;
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  return <>
    <input ref={visible} type="text" data-field={name} defaultValue={displayTime(defaultValue)} placeholder="9:00 AM"
      aria-label={ariaLabel} required={required} size={9} className={className} title="Hora de 12 horas con AM o PM, por ejemplo 2:30 PM"
      onChange={event => {
        const raw = event.currentTarget.value;
        const time = parseDisplayTime(raw);
        event.currentTarget.setCustomValidity(raw && !time ? "Escribe una hora válida con AM o PM, por ejemplo 2:30 PM." : "");
        if (hidden.current) hidden.current.value = time ?? "";
      }} />
    <input ref={hidden} type="hidden" name={name} defaultValue={defaultValue} />
  </>;
}
