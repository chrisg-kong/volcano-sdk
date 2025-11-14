import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llmGateway } from '../../dist/volcano-sdk.js';

const calls: any[] = [];

// Stub global fetch for the AIGateway provider
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(body);
    // Return an OpenAI-compatible tool_calls response so utils can map back
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 't1', function: { name: 'mcp_abc123_get_sign', arguments: '{"birthdate":"1993-07-11"}' } }
              ]
            }
          }
        ]
      })
    } as any;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AIGateway provider (unit)', () => {
  it('sanitizes tool names for outbound payload and maps back to dotted names', async () => {
    const llm: any = llmGateway({ apiKey: 'sk-test', baseURL: 'http://gateway.local/v1' });
    const tools = [
      {
        name: 'mcp_abc123.get_sign',
        description: 'Get sign',
        parameters: { type: 'object', properties: { birthdate: { type: 'string' } } }
      }
    ];

    const res = await llm.genWithTools('Do task', tools as any);

    expect(calls.length).toBe(1);
    // Outbound payload should have sanitized tool name (dots -> underscores)
    expect(calls[0].tools[0].function.name).toBe('mcp_abc123_get_sign');
    // Result should be mapped back to original dotted name
    expect(res.toolCalls[0].name).toBe('mcp_abc123.get_sign');
  });
});
