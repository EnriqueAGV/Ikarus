// Re-mounts on every navigation, so each page eases in.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-enter">{children}</div>;
}
