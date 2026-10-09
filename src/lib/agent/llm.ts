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

export function chatClient(
  baseUrl = env.LLM_BASE_URL,
  apiKey = env.LLM_API_KEY,
): ChatClient {
  return {
    async complete(req) {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ ...req, tool_choice: "auto" }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (!res.ok) throw new LlmError(res.status, text);
      const data = JSON.parse(text) as {
        choices?: { message?: ChatResponse["message"]; finish_reason?: string | null }[];
      };
      const choice = data.choices?.[0];
      if (!choice?.message) throw new LlmError(res.status, `no choices in response: ${text}`);
      return { message: choice.message, finishReason: choice.finish_reason ?? null };
    },
  };
}
