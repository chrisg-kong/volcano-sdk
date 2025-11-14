import type { LLMHandle, LLMToolResult, ToolDefinition } from "./types.js";
import { createOpenAICompatibleTools, parseOpenAICompatibleResponse } from "./utils.js";

export type AIGatewayOptions = {
  temperature?: number;
  max_tokens?: number; 
  max_completion_tokens?: number; 
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  response_format?: { type: "json_object" | "text" };
  n?: number;
  logit_bias?: Record<string, number>;
  user?: string;
};

export type AIGatewayConfig = {
  apiKey: string;
  baseURL: string; // Base URL
  model?: string;  // Optional - only included in payload if provided
  headers?: Record<string, string>;
  options?: AIGatewayOptions;
};

function buildEndpoint(baseURL: string): string {
  const url = baseURL.replace(/\/+$/, "");
  if (url.endsWith("/chat/completions")) return url;
  if (url.endsWith("/chat")) return `${url}/completions`;
  return `${url}/chat/completions`;
}

export function llmGateway(cfg: AIGatewayConfig): LLMHandle {
  const id = `AIGateway${cfg.model ? `-${cfg.model}` : ""}`;
  const model = cfg.model;
  const options = cfg.options || {};
  const endpoint = buildEndpoint(cfg.baseURL);

  const createHeaders = () => ({
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    ...(cfg.headers || {}),
  });

  const callLLM = async (body: any) => {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: createHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      const err: any = new Error(`AIGateway error ${r.status}`);
      err.status = r.status;
      err.body = text;
      throw err;
    }
    return r.json();
  };

  const basePayload = () => ({
    ...(model ? { model } : {}),
    ...options,
  });

  return {
    id,
    client: null as any,
    model: model || "",  

    gen: async (prompt: string): Promise<string> => {
      const data = await callLLM({
        ...basePayload(),
        messages: [{ role: "user", content: prompt }],
      });
      return data?.choices?.[0]?.message?.content ?? "";
    },

    genWithTools: async (prompt: string, tools: ToolDefinition[]): Promise<LLMToolResult> => {
      const { nameMap, formattedTools } = createOpenAICompatibleTools(tools);

      const data = await callLLM({
        ...basePayload(),
        messages: [{ role: "user", content: prompt }],
        tools: formattedTools,
        tool_choice: "auto",
      });

      const message = data?.choices?.[0]?.message;
      return parseOpenAICompatibleResponse(message, nameMap);
    },

    // Streaming implementation
    genStream: async function* (prompt: string) {
      const body: any = {
        ...basePayload(), // includes model? and ...options
        messages: [{ role: "user", content: prompt }],
        stream: true,
        // stream_options: { include_usage: true }, // enable if your gateway supports it
      };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: createHeaders(),
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const err: any = new Error(`AIGateway stream error ${resp.status}`);
        err.status = resp.status;
        err.body = text;
        throw err;
      }
      if (!resp.body) {
        throw new Error("AIGateway stream error: no response body");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim() || line.startsWith(':')) continue; // heartbeats/comments
            if (line === 'data: [DONE]') return;
            if (line.startsWith('data: ')) {
              const jsonData = line.slice(6); // remove 'data: '
              try {
                const parsed = JSON.parse(jsonData);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length > 0) {
                  yield delta;
                }
              } catch {
                // ignore malformed JSON lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
