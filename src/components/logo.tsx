import Image from "next/image";

// Brand files live in public/brand: praxia-logo (mark + name), praxia-icon (mark only).
export function Logo({ className = "h-9 w-auto self-start" }: { className?: string }) {
  return <Image src="/brand/praxia-logo.svg" alt="Praxia" width={579} height={172} priority className={className} />;
}

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return <Image src="/brand/praxia-icon.svg" alt="Praxia" width={174} height={172} className={className} />;
}
