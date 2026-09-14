import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';

// OpenRouter Batch API (beta): asynchronous inference at ~50% of per-token
// price, 24h completion window. Text-only; results come back inline on the
// batch object once status is `completed`. Docs: openrouter.ai/docs/batch-quickstart
const BATCH = 'https://openrouter.ai/api/beta/batches';

function authHeaders(): Record<string, string> | null {
  const key = process.env.OPENROUTER_API_KEY;
  return key ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : null;
}

async function asJson(res: Response) {
  const text = await res.text();
  if (!res.ok) return { error: `OpenRouter ${res.status}: ${text.slice(0, 400)}` };
  try { return JSON.parse(text); } catch { return { error: `Non-JSON response: ${text.slice(0, 200)}` }; }
}

function summarize(b: any) {
  return {
    id: b.id,
    status: b.status,
    endpoint: b.endpoint,
    model: b.model,
    completionWindow: b.completion_window,
    createdAt: b.created_at,
    finalizedAt: b.finalized_at,
    requestCounts: b.request_counts,
    usage: b.usage,
  };
}

export const openrouterBatchSubmitTool = tool({
  name: 'openrouter_batch_submit',
  description:
    'Submit an asynchronous batch of chat-completion requests to the OpenRouter Batch API (beta). Billed at roughly 50% of standard per-token price, 24h completion window, text-only. Returns 202 with status "validating"; poll with openrouter_batch_status. Use for offline work: evals, backfills, classification, summarisation over many items.',
  inputSchema: z.object({
    model: z.string().describe('Model slug applied to every request, e.g. deepseek/deepseek-chat-v3.1'),
    prompts: z
      .array(z.object({ custom_id: z.string().describe('Unique id within the batch'), prompt: z.string() }))
      .min(1)
      .max(500)
      .describe('One entry per request; each becomes a single user message'),
    system: z.string().optional().describe('Optional system prompt applied to every request'),
    max_tokens: z.number().int().min(1).max(8000).default(300),
    temperature: z.number().min(0).max(2).optional(),
  }),
  execute: async ({ model, prompts, system, max_tokens, temperature }) => {
    const headers = authHeaders();
    if (!headers) return { error: 'OPENROUTER_API_KEY is not set' };
    const requests = prompts.map((p) => ({
      custom_id: p.custom_id,
      body: {
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: p.prompt }],
        max_tokens,
        ...(temperature !== undefined ? { temperature } : {}),
      },
    }));
    // Field order matters: the API stream-parses and rejects `requests` before `endpoint`/`model`.
    const body = JSON.stringify({ endpoint: '/v1/chat/completions', model, requests });
    const data = await asJson(await fetch(BATCH, { method: 'POST', headers, body }));
    if (data.error) return data;
    return { ...summarize(data), hint: 'Poll openrouter_batch_status until status is completed|failed|expired|cancelled. Results arrive inline on completion.' };
  },
});

export const openrouterBatchStatusTool = tool({
  name: 'openrouter_batch_status',
  description:
    'Get an OpenRouter batch by id: status (validating → in_progress → finalizing → completed; or failed/expired/cancelled), request counts, usage.cost, and — once completed — the results mapped by custom_id.',
  inputSchema: z.object({
    id: z.string().describe('Batch id, e.g. batch_123'),
    include_results: z.boolean().default(true).describe('Return result texts when the batch is completed'),
    max_results: z.number().int().min(1).max(200).default(50),
  }),
  execute: async ({ id, include_results, max_results }) => {
    const headers = authHeaders();
    if (!headers) return { error: 'OPENROUTER_API_KEY is not set' };
    const data = await asJson(await fetch(`${BATCH}/${encodeURIComponent(id)}`, { headers }));
    if (data.error) return data;
    const out: Record<string, unknown> = summarize(data);
    if (include_results && Array.isArray(data.results)) {
      out.results = data.results.slice(0, max_results).map((r: any) => ({
        custom_id: r.custom_id,
        status_code: r.response?.status_code ?? null,
        text: r.response?.body?.choices?.[0]?.message?.content ?? null,
        finish_reason: r.response?.body?.choices?.[0]?.finish_reason ?? null,
        error: r.error ?? null,
      }));
      out.resultCount = data.results.length;
    }
    return out;
  },
});

export const openrouterBatchListTool = tool({
  name: 'openrouter_batch_list',
  description: 'List recent OpenRouter batches with status and request counts. Filter by status; page with `after`.',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(10),
    status: z.array(z.enum(['validating', 'in_progress', 'finalizing', 'completed', 'failed', 'expired', 'cancelling', 'cancelled'])).optional(),
    after: z.string().optional().describe('Batch id cursor from a previous page'),
  }),
  execute: async ({ limit, status, after }) => {
    const headers = authHeaders();
    if (!headers) return { error: 'OPENROUTER_API_KEY is not set' };
    const qs = new URLSearchParams({ limit: String(limit) });
    for (const s of status ?? []) qs.append('status', s);
    if (after) qs.set('after', after);
    const data = await asJson(await fetch(`${BATCH}?${qs}`, { headers }));
    if (data.error) return data;
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    return { batches: items.map(summarize), hasMore: data.has_more ?? null };
  },
});
