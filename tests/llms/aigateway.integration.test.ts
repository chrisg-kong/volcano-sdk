import { describe, it, expect } from 'vitest';
import { llmGateway } from '../../dist/volcano-sdk.js';

// Integration tests require a running OpenAI-compatible gateway
// Set environment variables before running:
//  - AIGW_BASE_URL (e.g., https://your-gateway.example.com/v1)
//  - AIGW_API_KEY  (bearer key header)
//  - AIGW_MODEL    (optional; provider may have a default)

const requireEnv = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for this test`);
  return v;
};

describe('AIGateway provider (integration)', () => {
  it('returns a toolCalls array (may be empty) on genWithTools', async () => {
    const baseURL = requireEnv('AIGW_BASE_URL');
    const apiKey = requireEnv('AIGW_API_KEY');
    const model = process.env.AIGW_MODEL; // optional

    const llm = llmGateway({ apiKey, baseURL, ...(model ? { model } : {}) });
    const tools: any = [{
      name: 'astro.get_sign',
      description: 'Return sign for birthdate',
      parameters: { type: 'object', properties: { birthdate: { type: 'string' } }, required: ['birthdate'] }
    }];

    const res = await llm.genWithTools('Find the astrological sign for 1993-07-11 using available tools.', tools);
    expect(Array.isArray(res.toolCalls)).toBe(true);
  }, 60000);

  it('streams tokens that concatenate to the non-stream answer', async () => {
    const baseURL = requireEnv('AIGW_BASE_URL');
    const apiKey = requireEnv('AIGW_API_KEY');
    const model = process.env.AIGW_MODEL; // optional

    const llm = llmGateway({ apiKey, baseURL, ...(model ? { model } : {}) });
    const prompt = 'Reply ONLY with STREAM_OK';
    const nonStream = await llm.gen(prompt);
    const normalizedA = nonStream.trim().replace(/[^A-Za-z0-9_]/g, '').toUpperCase();

    let streamed = '';
    for await (const chunk of llm.genStream(prompt)) {
      streamed += chunk;
    }
    const normalizedB = streamed.trim().replace(/[^A-Za-z0-9_]/g, '').toUpperCase();

    // Expect streamed concat to match non-stream result (normalized)
    expect(normalizedA).toBe(normalizedB);
    expect(normalizedA.length).toBeGreaterThan(0);
  }, 60000);

  it('can produce valid JSON when asked', async () => {
    const baseURL = requireEnv('AIGW_BASE_URL');
    const apiKey = requireEnv('AIGW_API_KEY');
    const model = process.env.AIGW_MODEL; // optional

    const llm = llmGateway({ apiKey, baseURL, ...(model ? { model } : {}) });
    const prompt = 'Return ONLY valid minified JSON: {"ok":true,"provider":"aigateway"}';
    const out = await llm.gen(prompt);
    const text = out.trim();
    // Extract JSON if wrapped in code fences
    const m = text.match(/\{[\s\S]*\}/);
    const jsonStr = m ? m[0] : text;
    const obj = JSON.parse(jsonStr);
    expect(obj && obj.ok === true && obj.provider === 'aigateway').toBe(true);
  }, 60000);
});
