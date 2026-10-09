// Every page here reads the session. Block on the server for now; adopting
// Suspense-streamed auth (Cache Components) can come later, route by route.
export const instant = false;

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
