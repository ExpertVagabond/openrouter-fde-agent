# openrouter-fde-agent

A terminal agent on `@openrouter/agent` that answers "which provider, which model, which routing setting" with live data instead of adjectives. Scaffolded from OpenRouter's [`create-agent-tui`](https://github.com/OpenRouterTeam/skills/tree/main/skills/create-agent-tui) skill, then given three sets of domain tools that call the OpenRouter API directly.

```
  ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗
  ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
  ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
  ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
  ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
  ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
```

## Run

```sh
npm install
cp .env.example .env            # OPENROUTER_API_KEY=sk-or-v1-...
npm start                        # interactive TUI (block input, grouped tool display, spinner)
npm run typecheck

# headless: one real question through the loop, capped at $0.10
node --env-file=.env node_modules/.bin/tsx src/smoke.ts "Which provider for a cost-sensitive batch job on deepseek/deepseek-chat-v3.1?"
```

Environment overrides: `AGENT_MODEL`, `AGENT_MAX_STEPS`, `AGENT_MAX_COST`, `AGENT_NO_SERVER_TOOLS=1`, `AGENT_DEBUG=1` (prints every stream item). `agent.config.json` in the working directory overrides the defaults in `src/config.ts`.

## Tools

| Tool | What it does | Source |
|---|---|---|
| `openrouter_endpoints` | Every provider endpoint for a model: $/1M prompt, completion, cache read; quantization; uptime 30m/1d; p50/p90 latency; throughput; implicit-caching flag. Sort by price, latency, uptime, throughput. | `GET /models/:id/endpoints` |
| `openrouter_probe` | One prompt through a routing config (`provider.order/sort/zdr/only/ignore`, `models[]` fallbacks, `openrouter/auto` + `cost_tier`, `user` for sticky routing) → provider that served, model, latency, tokens, cached tokens, `usage.cost`, `finish_reason`. | `POST /chat/completions` |
| `openrouter_batch_submit` / `_status` / `_list` | Batch API (beta): ~50% of per-token price, 24h window, text-only, results inline on completion. | `POST/GET /api/beta/batches` |
| `file_read`, `file_write`, `file_edit`, `glob`, `grep`, `list_dir`, `shell` | The skill's standard coding-agent tools. | client-side |
| `openrouter:web_search` | Server tool; OpenRouter executes it. Off when `AGENT_NO_SERVER_TOOLS=1`. | server-side |

## What a real run looks like

Question: *which provider should a cost-sensitive batch job use for `deepseek/deepseek-chat-v3.1` right now?* One `openrouter_endpoints` call, then (2026-09-14, claude-sonnet-4.6, $0.034 for the turn):

> DeepInfra `deepinfra/fp4` $0.25 / $0.95 per M, cache read $0.13, 99.82% uptime, p50 832 ms. Fallback Novita `novita/fp8` $0.27 / $1.00, 99.97%. Skip SiliconFlow, Mara, Google (down).
> ```json
> { "provider": { "order": ["deepinfra/fp4", "novita/fp8"], "allow_fallbacks": true } }
> ```
> `provider.order` disables load balancing; `allow_fallbacks: true` is what keeps the batch alive when DeepInfra hiccups.

## Things learned building it (2026-09-14)

1. **`@openrouter/agent` 0.4.0 (the skill sample's lockfile) silently returns nothing on a tool-calling turn against today's API.** 0.11.0 surfaces the real error. Install latest, as the skill says; do not trust the sample lock.
2. **`openrouter:datetime` + any client tool call = empty output array on claude-sonnet-4.6.** Reproduced by bisection: instructions alone fine, all client tools fine, `openrouter_endpoints` + `web_search` fine, `openrouter_endpoints` + `datetime` → empty text. Dropped datetime; `shell` can run `date`.
3. **`outputText` is gone in 0.11; use `await result.getText()`.** Empty finals after a tool round are retried once by default (`strictFinalResponse: false`).
4. **Batch API needs a model with a `:batch` endpoint.** `deepseek/deepseek-chat-v3.1`, `openai/gpt-4o-mini`, `anthropic/claude-haiku-4.5` all return `400 does not have a :batch endpoint`; `google/gemini-2.5-flash-lite` accepted a 2-request batch (`202 validating`). The `/endpoints` listing does not flag batch support, so the submit error is currently the only way to find out.
5. **Free models and the tool loop.** `thinkingmachines/inkling:free` is gated to listed agentic apps (403). `nvidia/nemotron-3-ultra-550b-a55b:free`, `nex-agi/nex-n2.5-pro:free`, `poolside/laguna-s-2.1:free` each emitted a tool call and ended the turn on the reasoning item with `serverToolUseDetails.toolCallsRequested: 1` — they reach for the paid server web-search tool. `AGENT_NO_SERVER_TOOLS=1` removes it for free-tier runs.
6. Tool objects from `tool()` are `{ type, function: { name, inputSchema, execute, description } }`; server tools are `{ _brand, config, id: "server:openrouter:<name>" }`.

## Layout

```
src/
  cli.ts            TUI entry: banner, input styles, slash commands, event rendering
  agent.ts          runAgent / runAgentWithRetry on client.callModel + stopWhen
  config.ts         defaults, agent.config.json + env overrides, system prompt
  tools/index.ts    tool list (client + server)
  tools/openrouter-endpoints.ts
  tools/openrouter-probe.ts
  tools/openrouter-batch.ts
  tools/{file-read,file-write,file-edit,glob,grep,list-dir,shell}.ts
  commands.ts       /model /new /help
  session.ts        JSONL session log in .sessions/
  renderer.ts loader.ts terminal-bg.ts banner.ts
  smoke.ts          headless one-question run
```

Companion repo with the routing measurements behind the system prompt: [openrouter-routing-lab](https://github.com/ExpertVagabond/openrouter-routing-lab).
