import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

// Send one prompt through a routing configuration and report the fields an FDE
// points at: which provider actually served, which model ran, usage.cost,
// cached tokens, latency, finish_reason. Same shape as openrouter-routing-lab.
export const openrouterProbeTool = tool({
  name: 'openrouter_probe',
  description:
    'Send one prompt through OpenRouter with a specific routing configuration and return which provider served it, which model ran, latency, tokens, cached tokens, USD cost and finish_reason. Use to measure a routing recommendation (provider.order, sort, zdr, :floor/:nitro suffix, openrouter/auto with cost_tier, models[] fallbacks) instead of asserting it. Each call costs real money; keep max_tokens small.',
  inputSchema: z.object({
    model: z.string().describe('Model id, e.g. deepseek/deepseek-chat-v3.1, anthropic/claude-haiku-4.5:floor, openrouter/auto'),
    prompt: z.string().describe('User message to send'),
    system: z.string().optional().describe('Optional system prompt'),
    max_tokens: z.number().int().min(1).max(4000).default(200).describe('Completion budget; reasoning models spend it on thinking first'),
    temperature: z.number().min(0).max(2).optional(),
    provider: z
      .object({
        order: z.array(z.string()).optional().describe('Provider slugs or endpoint tags in preference order, e.g. ["deepinfra/fp4","together"]'),
        allow_fallbacks: z.boolean().optional(),
        only: z.array(z.string()).optional(),
        ignore: z.array(z.string()).optional(),
        sort: z.enum(['price', 'throughput', 'latency']).optional(),
        zdr: z.boolean().optional(),
        data_collection: z.enum(['allow', 'deny']).optional(),
        require_parameters: z.boolean().optional(),
      })
      .optional()
      .describe('OpenRouter provider routing object'),
    models: z.array(z.string()).optional().describe('Model-level fallback list; tried in order if the primary fails at the request level'),
    cost_tier: z.enum(['low', 'medium', 'high', 'max']).optional().describe('Only with openrouter/auto: Auto Router cost band'),
    user: z.string().optional().describe('Stable end-user id; enables sticky routing and cache affinity'),
  }),
  execute: async ({ model, prompt, system, max_tokens, temperature, provider, models, cost_tier, user }) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { error: 'OPENROUTER_API_KEY is not set' };

    const messages: Array<{ role: string; content: string }> = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = { model, messages, max_tokens };
    if (temperature !== undefined) body.temperature = temperature;
    if (provider) body.provider = provider;
    if (models) body.models = models;
    if (user) body.user = user;
    if (cost_tier) body.plugins = [{ id: 'auto-router', cost_tier }];

    const started = performance.now();
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ExpertVagabond/openrouter-fde-agent',
        'X-Title': 'openrouter-fde-agent',
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) return { error: `OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`, latencyMs, request: body };

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    const usage = data.usage ?? {};
    const text: string = choice?.message?.content ?? '';
    return {
      id: data.id,
      provider: data.provider,
      model: data.model,
      latencyMs,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage.prompt_tokens_details?.cache_write_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      costUsd: usage.cost,
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason,
      text: text.length > 800 ? text.slice(0, 800) + '…' : text,
      request: body,
    };
  },
});
