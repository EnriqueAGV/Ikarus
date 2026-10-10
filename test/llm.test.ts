import { afterAll, describe, expect, it } from "vitest";
import { chatClient, LlmError } from "@/lib/agent/llm";
import { startFakeKapso } from "./fake-kapso";

const server = await startFakeKapso({
  "POST /v1/chat/completions": () => ({
    json: {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "list_services", arguments: "{}" } }],
          },
        },
      ],
    },
  }),
  "POST /broken/chat/completions": () => ({ status: 401, json: { error: { message: "bad key" } } }),
  // Hangs on the first call, answers on the next.
  "POST /slow/chat/completions": () => ({
    delayMs: slowCalls++ === 0 ? 1_000 : 0,
    json: { choices: [{ finish_reason: "stop", message: { content: "hola" } }] },
  }),
});
let slowCalls = 0;
afterAll(() => server.close());

describe("OpenAI-compatible client", () => {
  it("posts to <base>/chat/completions and returns the first choice", async () => {
    const llm = chatClient(`${server.url}/v1/`, "sk-test");
    const res = await llm.complete({ model: "m", messages: [{ role: "user", content: "hola" }], tools: [] });
    expect(res.finishReason).toBe("tool_calls");
    expect(res.message.tool_calls?.[0].function.name).toBe("list_services");
    expect(server.calls[0]).toMatchObject({
      path: "/v1/chat/completions",
      body: { model: "m", tool_choice: "auto", messages: [{ role: "user", content: "hola" }] },
    });
  });

  it("cuts off a call that hangs and tries again", async () => {
    const llm = chatClient(`${server.url}/slow`, "sk-test", { timeoutMs: 200 });
    const res = await llm.complete({ model: "m", messages: [], tools: [] });
    expect(res.message.content).toBe("hola");
    expect(server.calls.filter((c) => c.path === "/slow/chat/completions")).toHaveLength(2);
  });

  it("raises the endpoint's error", async () => {
    const llm = chatClient(`${server.url}/broken`, "sk-test");
    await expect(llm.complete({ model: "m", messages: [], tools: [] })).rejects.toBeInstanceOf(LlmError);
    // A bad key is not retried.
    expect(server.calls.filter((c) => c.path === "/broken/chat/completions")).toHaveLength(1);
  });
});
