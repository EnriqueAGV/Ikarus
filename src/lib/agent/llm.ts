import { env } from "@/lib/env";

// Minimal client for any OpenAI-compatible Chat Completions endpoint
// (OpenAI, Azure OpenAI, OpenRouter, Groq, Together, vLLM, Ollama...).
// Configured with LLM_BASE_URL, LLM_API_KEY and LLM_MODEL.

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatRequest = { model: string; messages: ChatMessage[]; tools: ChatTool[] };

export type ChatResponse = {
  message: { content: string | null; tool_calls?: ToolCall[] };
  finishReason: string | null;
};

export type ChatClient = { complete(req: ChatRequest): Promise<ChatResponse> };

export class LlmError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`LLM endpoint returned ${status}: ${body.slice(0, 500)}`);
  }
}

// A healthy call answers in seconds; one that hangs is cut off and tried
// again rather than holding the patient's reply for minutes.
const ATTEMPT_TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

function retryable(err: unknown) {
  if (err instanceof LlmError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return true; // timeouts and network errors
}

export function chatClient(
  baseUrl = env.LLM_BASE_URL,
  apiKey = env.LLM_API_KEY,
  { timeoutMs = ATTEMPT_TIMEOUT_MS, attempts = ATTEMPTS } = {},
): ChatClient {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // OpenRouter routes each call to one of several providers; prefer the fastest.
  const extra = new URL(url).hostname.endsWith("openrouter.ai") ? { provider: { sort: "latency" } } : {};

  async function once(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ ...req, tool_choice: "auto", ...extra }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new LlmError(res.status, text);
    const data = JSON.parse(text) as {
      choices?: { message?: ChatResponse["message"]; finish_reason?: string | null }[];
    };
    const choice = data.choices?.[0];
    if (!choice?.message) throw new LlmError(502, `no choices in response: ${text}`);
    return { message: choice.message, finishReason: choice.finish_reason ?? null };
  }

  return {
    async complete(req) {
      for (let attempt = 1; ; attempt++) {
        const started = Date.now();
        try {
          const out = await once(req);
          console.info("llm call", { model: req.model, attempt, ms: Date.now() - started });
          return out;
        } catch (err) {
          console.warn("llm call failed", { model: req.model, attempt, ms: Date.now() - started, error: String(err) });
          if (attempt >= attempts || !retryable(err)) throw err;
        }
      }
    },
  };
}
