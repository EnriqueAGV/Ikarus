import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Call = { method: string; path: string; body: unknown };

// A tiny stand-in for the Kapso API that records calls and answers with
// canned responses keyed by "METHOD /path".
export async function startFakeKapso(
  routes: Record<string, (body: unknown) => { status?: number; json: unknown }>,
) {
  const calls: Call[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method!, path, body });
      const key = Object.keys(routes).find((k) => {
        const [m, p] = k.split(" ");
        return m === req.method && new RegExp(`^${p}$`).test(path);
      });
      const out = key ? routes[key](body) : { status: 404, json: { error: "not found" } };
      res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
