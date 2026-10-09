import { ConfirmButton } from "@/components/confirm-button";
import { CopyButton } from "@/components/copy-button";
import { requireBusinessManager } from "@/lib/auth";
import { settingsErrorLabel } from "@/lib/dashboard/labels";
import { listMembers } from "@/lib/dashboard/team";
import { env } from "@/lib/env";
import { inviteMemberAction, removeMemberAction } from "../actions";

const roleLabel = { owner: "Dueño", staff: "Equipo" } as const;

export default async function TeamPage({ params, searchParams }: PageProps<"/app/[businessId]/team">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { business, profile } = await requireBusinessManager(businessId);
  const members = await listMembers(business.id);
  const error = typeof sp.error === "string" ? settingsErrorLabel[sp.error] ?? "Algo salió mal." : null;
  const loginUrl = `${env.APP_URL}/login`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {error && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {typeof sp.invited === "string" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <span>
            {sp.emailed
              ? `Listo. Enviamos una invitación a ${sp.invited}; con el enlace del correo crea su contraseña. Después entra en ${loginUrl}.`
              : `Listo. ${sp.invited} puede entrar en ${loginUrl} con ese correo.`}
          </span>
          <CopyButton text={loginUrl} />
        </div>
      )}
      {sp.exists && <p className="rounded-md border p-3 text-sm">Esa persona ya es parte del equipo.</p>}

      <ul className="divide-y rounded-md border">
        {members.map((m) => (
          <li key={m.memberId} className="flex items-center justify-between gap-2 px-4 py-3">
            <div>
              <div className="font-medium">{m.fullName ?? m.email}</div>
              {m.fullName && <div className="text-sm text-neutral-500">{m.email}</div>}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-neutral-500">{roleLabel[m.role]}</span>
              <form action={removeMemberAction.bind(null, business.id, m.memberId)}>
                <ConfirmButton
                  message={m.userId === profile.id ? "¿Quitarte del consultorio? Perderás el acceso." : `¿Quitar a ${m.email}?`}
                  className="text-xs text-red-700 hover:underline dark:text-red-400"
                >
                  Quitar
                </ConfirmButton>
              </form>
            </div>
          </li>
        ))}
        {members.length === 0 && <li className="px-4 py-3 text-sm text-neutral-500">Sin miembros.</li>}
      </ul>

      <form action={inviteMemberAction.bind(null, business.id)} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Correo
          <input name="email" type="email" required placeholder="persona@consultorio.com" className="w-64 rounded-md border px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Rol
          <select name="role" defaultValue="staff" className="rounded-md border px-2 py-1 text-sm">
            <option value="staff">Equipo: ve citas y pacientes</option>
            <option value="owner">Dueño: también ajustes y equipo</option>
          </select>
        </label>
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover">
          Invitar
        </button>
      </form>
    </div>
  );
}
