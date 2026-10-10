import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { Logo } from "@/components/logo";
import { NOTICE_VERSION } from "@/lib/agent/consent";

export const instant = false;

// The privacy notice patients accept on WhatsApp before the assistant helps
// them. Public, one per clinic, since the clinic is the data controller.
// DRAFT: the wording must be reviewed by a Salvadoran lawyer before launch.
export default async function PrivacyNoticePage({ params }: PageProps<"/privacidad/[businessId]">) {
  const { businessId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound();
  const [business] = await db
    .select({ name: schema.businesses.name })
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId));
  if (!business) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 text-sm leading-relaxed">
      <Logo />
      <h1 className="text-2xl font-semibold">Aviso de privacidad de {business.name}</h1>
      <p className="text-xs text-neutral-500">Versión {NOTICE_VERSION}</p>

      <h2 className="mt-2 font-semibold">Quién es responsable de sus datos</h2>
      <p>
        {business.name} (el consultorio) es responsable de sus datos personales. Usa Praxia, un servicio que guarda
        la agenda y el expediente del consultorio y responde los mensajes de WhatsApp en su nombre. Praxia trata sus
        datos solo por encargo del consultorio y siguiendo sus instrucciones.
      </p>

      <h2 className="mt-2 font-semibold">Qué datos guardamos</h2>
      <p>
        Su nombre, número de WhatsApp, fecha de nacimiento, los mensajes que nos envía, sus citas y el motivo de la
        consulta. En el consultorio también pueden registrarse su DUI, dirección, contactos de emergencia y su
        información de salud (alergias, enfermedades y notas médicas). Los datos de salud son datos sensibles y solo
        los ven los doctores del consultorio.
      </p>

      <h2 className="mt-2 font-semibold">Para qué los usamos</h2>
      <p>
        Para agendar, confirmar, cambiar y recordarle sus citas, para su atención médica y para llevar su expediente
        clínico como exige la ley. No los usamos para publicidad ni los vendemos.
      </p>

      <h2 className="mt-2 font-semibold">Con quién se comparten</h2>
      <p>
        Con el personal del consultorio según su función, y con los proveedores que hacen funcionar el servicio
        (alojamiento de datos, WhatsApp y el asistente automático de mensajes). Sus datos viajan y se guardan cifrados.
        No los compartimos con nadie más salvo con su autorización por escrito o cuando la ley lo exija.
      </p>

      <h2 className="mt-2 font-semibold">Cuánto tiempo los guardamos</h2>
      <p>
        El expediente clínico se conserva el tiempo que exigen las normas de salud, aunque usted deje de ser paciente.
        Por eso las notas médicas no se pueden borrar; sí se pueden corregir con una nota adicional.
      </p>

      <h2 className="mt-2 font-semibold">Sus derechos</h2>
      <p>
        Puede pedir ver sus datos, corregirlos, recibir una copia, oponerse a su uso o retirar este consentimiento,
        escribiendo al WhatsApp del consultorio o pidiéndolo en su próxima visita. Si retira el consentimiento, el
        asistente automático deja de atenderle y el consultorio le atiende directamente.
      </p>

      <h2 className="mt-2 font-semibold">Su autorización</h2>
      <p>
        Al tocar &quot;Acepto&quot; o escribir ACEPTO en WhatsApp, usted autoriza al consultorio a tratar sus datos personales y
        de salud para los fines descritos aquí. Guardamos la fecha y el mensaje con que lo aceptó.
      </p>
    </main>
  );
}
