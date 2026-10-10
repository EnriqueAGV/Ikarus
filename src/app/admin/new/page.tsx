import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { createBusinessAction } from "../actions";

const TIMEZONES = [
  ["America/El_Salvador", "El Salvador"],
  ["America/Mexico_City", "México (Ciudad de México)"],
  ["America/Tijuana", "México (Tijuana)"],
  ["America/Bogota", "Colombia"],
  ["America/Lima", "Perú"],
  ["America/Santiago", "Chile"],
  ["America/Argentina/Buenos_Aires", "Argentina"],
  ["America/Guatemala", "Centroamérica"],
  ["Europe/Madrid", "España"],
  ["America/New_York", "EE. UU. (Este)"],
  ["America/Los_Angeles", "EE. UU. (Pacífico)"],
] as const;

const errors: Record<string, string> = {
  invalid: "Revisa los datos: nombre del consultorio, nombre del doctor y su correo son obligatorios.",
  failed: "No se pudo crear el consultorio. Revisa las claves de Kapso y Supabase.",
};

export default async function NewBusinessPage({ searchParams }: PageProps<"/admin/new">) {
  await requireSuperAdmin();
  const { error } = await searchParams;
  const message = typeof error === "string" ? errors[error] : null;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8">
      <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
        ← Consultorios
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Nuevo consultorio</h1>
      <form action={createBusinessAction} className="flex flex-col gap-4">
        <Field label="Nombre del consultorio" name="name" required />
        <label className="flex flex-col gap-1 text-sm">
          Zona horaria
          <select name="timezone" className="rounded-md border px-3 py-2" defaultValue="America/El_Salvador">
            {TIMEZONES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Field label="Nombre del doctor, como lo verán los pacientes" name="ownerName" required />
        <Field label="Correo del doctor" name="ownerEmail" type="email" required />
        <Field label="Especialidad (opcional)" name="specialty" />
        <Field label="N.º JVPM (opcional)" name="jvpmNumber" />
        <label className="flex flex-col gap-1 text-sm">
          Días de prueba gratis
          <input name="trialDays" type="number" min={0} max={365} defaultValue={30} className="w-28 rounded-md border px-3 py-2" />
          <span className="text-xs text-neutral-500">0 para cobrar desde el inicio.</span>
        </label>
        <p className="text-sm text-neutral-500">
          Se crea la cuenta del doctor, su agenda y un enlace para conectar el WhatsApp del consultorio. El doctor recibe un correo para crear su contraseña y entrar a su panel.
        </p>
        {message && <p className="text-sm text-red-600">{message}</p>}
        <button className="rounded-md bg-brand px-3 py-2 text-white hover:bg-brand-hover">
          Crear consultorio y enlace
        </button>
      </form>
    </main>
  );
}

function Field(props: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        className="rounded-md border px-3 py-2"
      />
    </label>
  );
}
