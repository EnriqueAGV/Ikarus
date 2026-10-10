"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatLocal } from "@/lib/dashboard/labels";
import type { schema } from "@/db";
import type { FormAction, FormResult } from "@/lib/dashboard/form-result";
import type { ReplyEligibility } from "@/lib/messaging/eligibility";

type Message = typeof schema.messages.$inferSelect;
function bodyText(type: string) {
  return ({ image: "Imagen recibida", document: "Documento recibido", audio: "Mensaje de audio", location: "Ubicación compartida", interactive: "Respuesta interactiva", button: "Respuesta a un botón" } as Record<string, string>)[type] ?? "Mensaje adjunto";
}
function MessageBody({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline">{part}</a> : part)}</>;
}
export function Conversation({ messages, hasOlder, timezone, recipient, phone, eligibility, reply, loadOlder, controls, paused, readOnly = false }: {
  messages: Message[]; hasOlder: boolean; timezone: string; recipient: string; phone: string;
  eligibility: ReplyEligibility; reply: FormAction; loadOlder: (beforeId: string) => Promise<Message[]>;
  controls: React.ReactNode; paused: boolean; readOnly?: boolean;
}) {
  const router = useRouter();
  const timeline = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const initial = useRef(true);
  const [older, setOlder] = useState<Message[]>([]);
  const [more, setMore] = useState(hasOlder);
  const [text, setText] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [result, setResult] = useState<FormResult | null>(null);
  const [pending, start] = useTransition();
  const [loadingHistory, historyStart] = useTransition();
  const [newMessages, setNewMessages] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const allMessages = [...older.filter(m => !messages.some(n => n.id === m.id)), ...messages];
  const uncertain = result?.code === "send_uncertain" || result?.code === "pending_send" || result?.code === "attempt_changed";
  const expired = eligibility.expiresAt && now !== null && now >= Date.parse(eligibility.expiresAt);
  const reason = eligibility.reason ?? (expired ? "window_closed" : null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    if (initial.current || stickToBottom.current) el.scrollTop = el.scrollHeight;
    else setNewMessages(true);
    initial.current = false;
  }, [messages]);
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const resize = new ResizeObserver(() => { if (stickToBottom.current) el.scrollTop = el.scrollHeight; });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!text) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      if ((event.target as Element).closest("a[href]") && !window.confirm("Hay una respuesta sin enviar. ¿Salir sin enviarla?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", navigate, true); };
  }, [text]);
  return <section id="conversation" className="card conversation-workspace overflow-hidden">
    <header className="flex flex-wrap items-start justify-between gap-5 border-b p-6">
      <div><h3 className="text-lg font-semibold">Conversación con {recipient}</h3><p className="mt-1 text-sm text-muted">{phone} · {paused ? "Asistente en pausa" : "Asistente activo"}</p></div>
      <div className="flex flex-wrap items-center gap-2">{controls}<button type="button" className="btn-quiet" onClick={() => router.refresh()}>Actualizar</button></div>
    </header>
    <p className="px-6 pt-4 text-xs text-muted">Devolver al asistente permite atender nuevos mensajes de este WhatsApp; no resuelve por sí solo el pendiente del equipo.</p>
    <div className="relative min-h-0 flex-1">
      <div ref={timeline} tabIndex={0} aria-label="Historial de la conversación" className="conversation-timeline" onScroll={() => {
        const el = timeline.current!;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (stickToBottom.current) setNewMessages(false);
      }}>
        {more && <div className="mb-5 text-center"><button type="button" disabled={loadingHistory} className="btn-secondary" onClick={() => historyStart(async () => {
          const el = timeline.current!;
          const height = el.scrollHeight;
          try {
            const batch = await loadOlder(allMessages[0].id);
            setOlder(current => [...batch.reverse(), ...current]);
            setMore(batch.length === 50);
            requestAnimationFrame(() => { el.scrollTop += el.scrollHeight - height; });
          } catch { setResult({ ok: false, message: "No se pudo cargar el historial. Inténtalo de nuevo." }); }
        })}>{loadingHistory ? "Cargando…" : "Cargar mensajes anteriores"}</button></div>}
        <ol className="flex flex-col gap-3">{allMessages.map((m, i) => {
          const day = formatLocal(m.createdAt, timezone, "d MMM yyyy");
          const previousDay = i ? formatLocal(allMessages[i - 1].createdAt, timezone, "d MMM yyyy") : null;
          const outbound = m.direction === "outbound";
          const staff = typeof m.payload === "object" && m.payload !== null && "sentBy" in m.payload;
          return <li key={m.id} className="flex flex-col">{day !== previousDay && <p className="my-3 text-center text-xs text-muted">{day}</p>}
            <div className={`message-bubble ${outbound ? "self-end bg-[#eaf4ee]" : "self-start bg-neutral-100"}`}>
              <p className="mb-1 text-xs font-semibold text-muted">{outbound ? staff ? "Equipo" : "Asistente" : recipient}</p>
              <p className="whitespace-pre-wrap break-words"><MessageBody text={m.body ?? bodyText(m.type)} /></p>
              <p className="mt-2 text-xs text-muted">{formatLocal(m.createdAt, timezone, "HH:mm")}</p>
            </div>
          </li>;
        })}{!allMessages.length && <li className="py-12 text-center text-sm text-muted">Aún no hay mensajes en este WhatsApp.</li>}</ol>
      </div>
      {newMessages && <button type="button" className="btn-primary absolute bottom-3 left-1/2 -translate-x-1/2" onClick={() => { stickToBottom.current = true; timeline.current!.scrollTop = timeline.current!.scrollHeight; setNewMessages(false); }}>Ir a los últimos mensajes</button>}
    </div>
    <form className="space-y-4 border-t p-6" onSubmit={event => {
      event.preventDefault();
      if (pending || reason || readOnly || uncertain) return;
      const id = attemptId ?? crypto.randomUUID();
      setAttemptId(id);
      const data = new FormData(); data.set("text", text); data.set("attemptId", id);
      start(async () => {
        try {
          const next = await reply(data); setResult(next);
          if (next.ok) { setText(""); setAttemptId(null); stickToBottom.current = true; router.refresh(); }
        } catch { setResult({ ok: false, code: "send_uncertain", message: "No pudimos confirmar el envío. Conservamos tu respuesta; revisa WhatsApp antes de volver a enviar." }); }
      });
    }}>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>Enviar a {recipient} · {phone}</span><span>{readOnly ? "Expediente de solo lectura" : reason === "no_whatsapp" ? "Sin WhatsApp registrado" : reason === "not_connected" ? "WhatsApp de la clínica desconectado" : reason ? "La ventana para responder terminó" : eligibility.expiresAt ? `Disponible hasta ${formatLocal(new Date(eligibility.expiresAt), timezone, "d MMM, HH:mm")}` : ""}</span></div>
      <label className="block text-sm font-medium" htmlFor="reply-text">Respuesta del equipo</label>
      <textarea id="reply-text" name="text" rows={3} required maxLength={4000} disabled={pending || readOnly} value={text} onChange={e => setText(e.target.value)} placeholder="Escribe la respuesta de la clínica" className="w-full" aria-describedby="reply-help" />
      <div className="flex flex-wrap items-center justify-between gap-3"><p id="reply-help" className="max-w-lg text-xs text-muted">{reason ? "No se puede enviar texto por WhatsApp en este momento. Puedes llamar al contacto; tu respuesta permanece aquí." : "Al enviar, el asistente se pausa para todos los pacientes que comparten este WhatsApp."}</p><button className="btn-primary" disabled={pending || !!reason || readOnly || uncertain || !text.trim()}>{pending ? "Enviando…" : "Enviar por WhatsApp"}</button></div>
      {uncertain && <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => router.refresh()}>Comprobar conversación</button><button type="button" className="btn-secondary" onClick={() => { if (window.confirm("Este mensaje pudo haberse enviado. ¿Ya revisaste WhatsApp y necesitas preparar un envío distinto?")) { setAttemptId(null); setResult(null); } }}>Preparar otro envío</button></div>}
      {result && <p role={result.ok ? "status" : "alert"} className={`notice ${result.ok ? "notice-ok" : "notice-error"}`}>{result.message}</p>}
    </form>
  </section>;
}
