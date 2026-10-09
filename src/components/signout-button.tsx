import { signOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="text-sm text-neutral-500 hover:underline">Salir</button>
    </form>
  );
}
