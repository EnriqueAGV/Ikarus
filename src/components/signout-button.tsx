import { signOut } from "@/app/login/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="rounded-full px-3 py-1.5 text-sm text-neutral-600 hover:bg-black/5 hover:text-foreground">Salir</button>
    </form>
  );
}
