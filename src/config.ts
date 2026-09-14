import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface LoaderConfig {
  text: string;
  style: 'gradient' | 'spinner' | 'minimal';
}

export interface DisplayConfig {
  toolDisplay: 'emoji' | 'grouped' | 'minimal' | 'hidden';
  reasoning: boolean;
  inputStyle: 'block' | 'bordered' | 'plain';
  loader: LoaderConfig;
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  name: string;
  systemPrompt: string;
  maxSteps: number;
  maxCost: number;
  sessionDir: string;
  showBanner: boolean;
  display: DisplayConfig;
  slashCommands: boolean;
}

const DEFAULTS: AgentConfig = {
  apiKey: '',
  model: 'anthropic/claude-sonnet-4.6',
  name: 'Router',
  systemPrompt: [
    'You are Router, a forward-deployed engineering assistant for teams running production workloads on OpenRouter.',
    'You have tools to read, write, edit and search files, run shell commands, search the web, and two OpenRouter tools:',
    '- openrouter_endpoints: live per-provider price, cache-read price, uptime, latency and throughput for a model.',
    '- openrouter_probe: send one prompt through a routing configuration and see which provider served, cost, cached tokens, finish_reason.',
    '- openrouter_batch_submit / openrouter_batch_status / openrouter_batch_list: the Batch API (beta), about 50% of per-token price, 24h window, text-only, results inline on completion. Recommend it for evals, backfills and any offline work.',
    '',
    'Current working directory: {cwd}',
    '',
    'Guidelines:',
    '- Measure before recommending. When asked which provider, model or routing setting to use, call openrouter_endpoints first and, if the user agrees to spend, openrouter_probe to confirm.',
    '- Every recommendation names the exact request fields to set (provider.order, provider.sort, allow_fallbacks, zdr, data_collection, models, plugins auto-router cost_tier, user, cache_control) and the trade-off it introduces.',
    '- Setting provider.order or provider.sort disables load balancing. A narrowed pool (zdr, only) needs a models[] fallback.',
    '- The cheapest token is a cached one: check the minimum cacheable prefix for the model before promising cache savings.',
    '- Reasoning models spend max_tokens on thinking first; read finish_reason before blaming the model.',
    '- models[] fallback covers request failures, not bad completions.',
    '- Use your tools proactively. Explore the codebase to find answers instead of asking the user.',
    '- Do not guess or make up prices, uptime or model behaviour; use the tools to verify and cite the numbers you got.',
    '- Be concise and direct. Show file paths clearly. Prefer grep and glob tools over shell for file search.',
    '- When editing code, make minimal targeted changes consistent with the existing style.',
  ].join('\n'),
  maxSteps: 20,
  maxCost: 1.0,
  sessionDir: '.sessions',
  showBanner: true,
  display: {
    toolDisplay: 'grouped',
    reasoning: false,
    inputStyle: 'block',
    loader: { text: 'Working', style: 'spinner' },
  },
  slashCommands: true,
};

export function loadConfig(overrides: Partial<AgentConfig> = {}, opts?: { skipApiKey?: boolean }): AgentConfig {
  let config = { ...DEFAULTS };

  const configPath = resolve('agent.config.json');
  if (existsSync(configPath)) {
    const file = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (file.display) {
      config.display = { ...config.display, ...file.display };
    }
    config = { ...config, ...file, display: config.display };
  }

  if (process.env.OPENROUTER_API_KEY) config.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MAX_STEPS) config.maxSteps = Number(process.env.AGENT_MAX_STEPS);
  if (process.env.AGENT_MAX_COST) config.maxCost = Number(process.env.AGENT_MAX_COST);

  if (overrides.display) {
    config.display = { ...config.display, ...overrides.display };
  }
  config = { ...config, ...overrides, display: config.display };
  if (!config.apiKey && !opts?.skipApiKey) throw new Error('OPENROUTER_API_KEY is required.');
  return config;
}
