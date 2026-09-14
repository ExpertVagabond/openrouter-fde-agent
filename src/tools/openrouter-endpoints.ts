import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

// Per-provider view of one model: price, cache-read price, uptime, p50/p90
// latency and throughput. This is GET /models/:author/:slug/endpoints, the
// page an FDE opens before recommending `provider.order` or `sort`.
export const openrouterEndpointsTool = tool({
  name: 'openrouter_endpoints',
  description:
    'List every provider endpoint serving an OpenRouter model with live price per 1M tokens (prompt, completion, cache read), quantization, uptime over the last 30m/1d, p50/p90 latency and throughput, and whether implicit caching is supported. Use before recommending provider.order, provider.sort, zdr, or a cheaper provider.',
  inputSchema: z.object({
    model: z.string().describe('OpenRouter model id, e.g. deepseek/deepseek-chat-v3.1'),
    sort: z.enum(['price', 'latency', 'uptime', 'throughput']).optional().describe('Sort order (default price)'),
  }),
  execute: async ({ model, sort }) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { error: 'OPENROUTER_API_KEY is not set' };
    const res = await fetch(`${BASE}/models/${model}/endpoints`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { error: `OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const data = (await res.json()) as { data: { id: string; name: string; endpoints: any[] } };

    const perM = (s: string | undefined) => (s ? Math.round(Number(s) * 1e6 * 1000) / 1000 : null);
    const rows = data.data.endpoints.map((e) => ({
      provider: e.provider_name as string,
      tag: e.tag as string,
      quantization: (e.quantization ?? null) as string | null,
      promptPerM: perM(e.pricing?.prompt),
      completionPerM: perM(e.pricing?.completion),
      cacheReadPerM: perM(e.pricing?.input_cache_read),
      contextLength: e.context_length as number,
      uptime30m: e.uptime_last_30m == null ? null : Math.round(e.uptime_last_30m * 100) / 100,
      uptime1d: e.uptime_last_1d == null ? null : Math.round(e.uptime_last_1d * 100) / 100,
      latencyP50Ms: e.latency_last_30m?.p50 ?? null,
      latencyP90Ms: e.latency_last_30m?.p90 == null ? null : Math.round(e.latency_last_30m.p90),
      throughputP50Tps: e.throughput_last_30m?.p50 ?? null,
      implicitCaching: Boolean(e.supports_implicit_caching),
      status: e.status as number,
    }));

    const by = sort ?? 'price';
    rows.sort((a, b) => {
      switch (by) {
        case 'latency': return (a.latencyP50Ms ?? 1e9) - (b.latencyP50Ms ?? 1e9);
        case 'uptime': return (b.uptime1d ?? -1) - (a.uptime1d ?? -1);
        case 'throughput': return (b.throughputP50Tps ?? -1) - (a.throughputP50Tps ?? -1);
        default: return ((a.promptPerM ?? 1e9) + (a.completionPerM ?? 1e9)) - ((b.promptPerM ?? 1e9) + (b.completionPerM ?? 1e9));
      }
    });

    return {
      model: data.data.id,
      name: data.data.name,
      sortedBy: by,
      endpoints: rows,
      hint: 'Prices are USD per 1M tokens. Setting provider.order or provider.sort disables load balancing; pair a narrowed pool (zdr, only) with a models[] fallback.',
    };
  },
});
